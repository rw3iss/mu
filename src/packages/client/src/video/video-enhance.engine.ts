/**
 * Real-time video enhancement engine built on WebGPU.
 *
 * The pipeline:
 *   1. <video> element plays through HLS.js as normal — audio + DRM +
 *      seek + fullscreen all stay on the underlying element.
 *   2. `copyExternalImageToTexture(video)` uploads each new frame to a
 *      GPU texture at the video's native resolution. The browser uses
 *      the hardware decoder's existing GPU surface; no CPU readback.
 *   3. A single fragment-shader pass samples that texture with the GPU's
 *      bilinear sampler (= free linear upscaling) and applies a 5-tap
 *      unsharp mask to restore edge definition.
 *   4. The shader output goes to a canvas at backing-store size
 *      (videoWidth * scale) × (videoHeight * scale). CSS scales the
 *      canvas to fill the video's display box, so the perceived
 *      resolution stays consistent regardless of the player size.
 *
 * What it is NOT:
 *   - A neural-net super-resolver. We're doing a deterministic linear
 *     resample + edge-enhancement, not learned detail synthesis. It
 *     makes low-bitrate 720p source look meaningfully crisper at 1080p
 *     output, but it can't invent texture that isn't there.
 *   - A replacement for the existing CSS-filter colour grading on the
 *     Video tab. Those operate on the <video> element which is hidden
 *     while this engine runs. To run both, the shader would need to
 *     accept the same params as uniforms — left as a future extension.
 *
 * Lifecycle:
 *   const engine = new VideoEnhanceEngine();
 *   await engine.init(canvas, video);     // async — adapter + device
 *   engine.setParams({ strength: 0.5, scale: 1.5 });
 *   engine.start();                        // requestVideoFrameCallback loop
 *   ...
 *   engine.destroy();                      // cancels loop, releases GPU
 */

const SHADER_WGSL = /* wgsl */ `
struct Params {
	texel_x: f32,
	texel_y: f32,
	strength: f32,
	_pad: f32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var src_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

struct VsOut {
	@builtin(position) pos: vec4f,
	@location(0) uv: vec2f,
}

// Fullscreen triangle: covers the whole NDC quad with one primitive,
// no vertex buffer required. Vertex indices 0,1,2 → three corners.
@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VsOut {
	var positions = array<vec2f, 3>(
		vec2f(-1.0, -1.0),
		vec2f( 3.0, -1.0),
		vec2f(-1.0,  3.0),
	);
	var uvs = array<vec2f, 3>(
		vec2f(0.0, 1.0),
		vec2f(2.0, 1.0),
		vec2f(0.0, -1.0),
	);
	var out: VsOut;
	out.pos = vec4f(positions[vid], 0.0, 1.0);
	out.uv = uvs[vid];
	return out;
}

// 5-tap unsharp mask: center + strength * (center - cross_blur).
// At strength 0 this collapses to a passthrough; at strength 1 you get
// aggressive edge enhancement with visible ringing near high contrast.
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
	let uv = in.uv;
	let tx = params.texel_x;
	let ty = params.texel_y;
	let s = params.strength;

	let c = textureSample(src, src_sampler, uv);
	if (s <= 0.001) {
		return c;
	}
	let n = textureSample(src, src_sampler, uv + vec2f(0.0, -ty));
	let so = textureSample(src, src_sampler, uv + vec2f(0.0, ty));
	let e = textureSample(src, src_sampler, uv + vec2f(tx, 0.0));
	let w = textureSample(src, src_sampler, uv + vec2f(-tx, 0.0));

	let blur = (n + so + e + w) * 0.25;
	let enhanced = c + s * (c - blur);
	return vec4f(clamp(enhanced.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

export interface VideoEnhanceParams {
	/** Unsharp-mask amount in 0..1. */
	strength: number;
	/** Output canvas resolution = video native × scale. 1..2.5. */
	scale: number;
}

interface ResolvedSurface {
	device: GPUDevice;
	context: GPUCanvasContext;
	canvasFormat: GPUTextureFormat;
	pipeline: GPURenderPipeline;
	sampler: GPUSampler;
	paramsBuffer: GPUBuffer;
	bindGroupLayout: GPUBindGroupLayout;
	/** Recreated whenever the source video size changes. */
	srcTexture: GPUTexture | null;
	srcWidth: number;
	srcHeight: number;
	bindGroup: GPUBindGroup | null;
}

export class VideoEnhanceEngine {
	private surface: ResolvedSurface | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private video: HTMLVideoElement | null = null;
	private rVFCHandle = 0;
	private destroyed = false;
	private params: VideoEnhanceParams = { strength: 0.5, scale: 1.5 };
	/** Set true when an unrecoverable error occurs; we stop pumping frames. */
	private errored = false;
	private onErrorCallback: ((err: Error) => void) | null = null;

	static isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'gpu' in navigator;
	}

	onError(cb: (err: Error) => void): void {
		this.onErrorCallback = cb;
	}

	/** Async — needs to request GPU adapter + device. Returns false if WebGPU isn't available. */
	async init(canvas: HTMLCanvasElement, video: HTMLVideoElement): Promise<boolean> {
		if (!VideoEnhanceEngine.isSupported()) return false;

		try {
			const adapter = await navigator.gpu.requestAdapter();
			if (!adapter) return false;
			const device = await adapter.requestDevice();
			if (this.destroyed) {
				device.destroy();
				return false;
			}

			device.lost.then((info) => {
				// 'destroyed' is the normal teardown reason — ignore.
				if (info.reason !== 'destroyed') {
					this.errored = true;
					this.onErrorCallback?.(new Error(`WebGPU device lost: ${info.message}`));
				}
			});

			const context = canvas.getContext('webgpu');
			if (!context) {
				device.destroy();
				return false;
			}

			const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
			context.configure({
				device,
				format: canvasFormat,
				alphaMode: 'opaque',
			});

			const shaderModule = device.createShaderModule({ code: SHADER_WGSL });

			const bindGroupLayout = device.createBindGroupLayout({
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.FRAGMENT,
						texture: { sampleType: 'float' },
					},
					{
						binding: 1,
						visibility: GPUShaderStage.FRAGMENT,
						sampler: { type: 'filtering' },
					},
					{
						binding: 2,
						visibility: GPUShaderStage.FRAGMENT,
						buffer: { type: 'uniform' },
					},
				],
			});

			const pipeline = device.createRenderPipeline({
				layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
				vertex: { module: shaderModule, entryPoint: 'vs' },
				fragment: {
					module: shaderModule,
					entryPoint: 'fs',
					targets: [{ format: canvasFormat }],
				},
				primitive: { topology: 'triangle-list' },
			});

			const sampler = device.createSampler({
				magFilter: 'linear',
				minFilter: 'linear',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge',
			});

			// 4 floats × 4 bytes = 16 bytes, aligned to UBO minimum.
			const paramsBuffer = device.createBuffer({
				size: 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});

			this.canvas = canvas;
			this.video = video;
			this.surface = {
				device,
				context,
				canvasFormat,
				pipeline,
				sampler,
				paramsBuffer,
				bindGroupLayout,
				srcTexture: null,
				srcWidth: 0,
				srcHeight: 0,
				bindGroup: null,
			};

			this.writeParams();
			return true;
		} catch (err) {
			this.onErrorCallback?.(err instanceof Error ? err : new Error(String(err)));
			return false;
		}
	}

	setParams(next: Partial<VideoEnhanceParams>): void {
		if (next.strength !== undefined) this.params.strength = next.strength;
		if (next.scale !== undefined) this.params.scale = next.scale;
		this.writeParams();
	}

	/** Begin requesting frames. No-op if init failed. */
	start(): void {
		if (!this.surface || !this.video || this.destroyed || this.errored) return;
		// Resize the canvas backing store + ensure src texture exists for current video.
		this.maybeResize();

		const tick = () => {
			if (this.destroyed || this.errored) return;
			this.renderFrame();
			const v = this.video;
			if (v && 'requestVideoFrameCallback' in v) {
				this.rVFCHandle = (v as any).requestVideoFrameCallback(tick);
			} else if (v) {
				// Fallback: rAF if rVFC isn't supported (mostly older Safari).
				this.rVFCHandle = window.requestAnimationFrame(tick);
			}
		};
		tick();
	}

	stop(): void {
		const v = this.video;
		if (v && this.rVFCHandle) {
			if ('cancelVideoFrameCallback' in v) {
				(v as any).cancelVideoFrameCallback(this.rVFCHandle);
			} else {
				window.cancelAnimationFrame(this.rVFCHandle);
			}
		}
		this.rVFCHandle = 0;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stop();
		if (this.surface) {
			this.surface.srcTexture?.destroy();
			this.surface.paramsBuffer.destroy();
			this.surface.device.destroy();
			this.surface = null;
		}
		this.canvas = null;
		this.video = null;
	}

	private writeParams(): void {
		const s = this.surface;
		if (!s) return;
		const texelX = s.srcWidth > 0 ? 1 / s.srcWidth : 1 / 1920;
		const texelY = s.srcHeight > 0 ? 1 / s.srcHeight : 1 / 1080;
		// Layout matches the `Params` struct in WGSL — 4 floats.
		const data = new Float32Array([texelX, texelY, this.params.strength, 0]);
		s.device.queue.writeBuffer(s.paramsBuffer, 0, data);
	}

	/**
	 * Ensure the canvas backing store matches `videoWidth * scale`, and
	 * recreate the source texture if the video's native size changed.
	 */
	private maybeResize(): void {
		const s = this.surface;
		const canvas = this.canvas;
		const video = this.video;
		if (!s || !canvas || !video) return;

		const vw = video.videoWidth || 0;
		const vh = video.videoHeight || 0;
		if (vw === 0 || vh === 0) return;

		// Backing store size — capped to a sane ceiling so absurd scale
		// values don't try to render an 8K texture.
		const targetW = Math.min(7680, Math.round(vw * this.params.scale));
		const targetH = Math.min(4320, Math.round(vh * this.params.scale));
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;

		// Source texture: only resize when the video's native size changes.
		if (s.srcTexture === null || s.srcWidth !== vw || s.srcHeight !== vh) {
			s.srcTexture?.destroy();
			s.srcTexture = s.device.createTexture({
				size: [vw, vh, 1],
				format: 'rgba8unorm',
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT,
			});
			s.srcWidth = vw;
			s.srcHeight = vh;
			s.bindGroup = s.device.createBindGroup({
				layout: s.bindGroupLayout,
				entries: [
					{ binding: 0, resource: s.srcTexture.createView() },
					{ binding: 1, resource: s.sampler },
					{ binding: 2, resource: { buffer: s.paramsBuffer } },
				],
			});
			this.writeParams(); // texel size depends on srcWidth/srcHeight
		}
	}

	private renderFrame(): void {
		const s = this.surface;
		const video = this.video;
		if (!s || !video || video.readyState < 2) return;

		this.maybeResize();
		if (!s.srcTexture || !s.bindGroup) return;

		// Upload the current video frame to the source texture. On Chromium
		// + GPU-decoded video this is a zero-copy texture-share; on
		// software decode it's a fast GPU upload from a CPU surface.
		try {
			s.device.queue.copyExternalImageToTexture(
				{ source: video },
				{ texture: s.srcTexture },
				[s.srcWidth, s.srcHeight],
			);
		} catch (err) {
			// `copyExternalImageToTexture` throws on tainted or DRM-protected
			// frames. Disable to avoid spamming errors per-frame.
			this.errored = true;
			this.onErrorCallback?.(
				err instanceof Error ? err : new Error('copyExternalImageToTexture failed'),
			);
			return;
		}

		// Single-pass render: src texture → canvas, through unsharp shader.
		const encoder = s.device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: s.context.getCurrentTexture().createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
				},
			],
		});
		pass.setPipeline(s.pipeline);
		pass.setBindGroup(0, s.bindGroup);
		pass.draw(3, 1, 0, 0);
		pass.end();
		s.device.queue.submit([encoder.finish()]);
	}
}
