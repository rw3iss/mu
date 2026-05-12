/**
 * Real-time video enhancement engine built on WebGPU.
 *
 * The pipeline:
 *   1. <video> element plays through HLS.js as normal — audio + DRM +
 *      seek + fullscreen all stay on the underlying element.
 *   2. `importExternalTexture({ source: video })` per frame: WebGPU's
 *      zero-copy primitive for sampling a hardware-decoded video frame.
 *      Handles YUV→RGB conversion internally, works correctly across
 *      Dawn backends (Vulkan, Metal, D3D12, OpenGLES via ANGLE).
 *   3. A single fragment-shader pass samples the external texture via
 *      `textureSampleBaseClampToEdge` (the function GPU-side for sampling
 *      external textures) using the GPU's bilinear sampler — free linear
 *      upscaling — and applies a 5-tap unsharp mask.
 *   4. Output goes to a canvas at backing-store size (videoWidth * scale)
 *      × (videoHeight * scale). CSS scales the canvas to fill the
 *      wrapper.
 *
 * What it is NOT:
 *   - A neural-net super-resolver. Deterministic linear resample + edge
 *     enhancement, not learned detail synthesis. Makes low-bitrate 720p
 *     source look meaningfully crisper at 1080p output but can't invent
 *     texture that isn't there.
 *   - A replacement for the existing CSS-filter colour grading on the
 *     Video tab — that operates on the <video> element which is hidden
 *     behind our canvas. To run both, the shader would need to accept
 *     the same params as uniforms.
 *
 * Lifecycle:
 *   const engine = new VideoEnhanceEngine();
 *   await engine.init(canvas, video);
 *   engine.setParams({ strength: 0.5, scale: 1.5 });
 *   engine.start();
 *   ...
 *   engine.destroy();
 */

const SHADER_WGSL = /* wgsl */ `
struct Params {
	texel_x: f32,
	texel_y: f32,
	strength: f32,
	_pad: f32,
}

@group(0) @binding(0) var src: texture_external;
@group(0) @binding(1) var src_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

struct VsOut {
	@builtin(position) pos: vec4f,
	@location(0) uv: vec2f,
}

// Fullscreen triangle: covers the whole NDC quad with one primitive, no
// vertex buffer required.
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
// textureSampleBaseClampToEdge is the only sampling function valid for
// external textures (the spec doesn't expose mipmaps for these).
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
	let uv = in.uv;
	let c = textureSampleBaseClampToEdge(src, src_sampler, uv);
	let s = params.strength;
	if (s <= 0.001) {
		return c;
	}
	let tx = params.texel_x;
	let ty = params.texel_y;
	let n = textureSampleBaseClampToEdge(src, src_sampler, uv + vec2f(0.0, -ty));
	let so = textureSampleBaseClampToEdge(src, src_sampler, uv + vec2f(0.0, ty));
	let e = textureSampleBaseClampToEdge(src, src_sampler, uv + vec2f(tx, 0.0));
	let w = textureSampleBaseClampToEdge(src, src_sampler, uv + vec2f(-tx, 0.0));
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
	srcWidth: number;
	srcHeight: number;
}

export class VideoEnhanceEngine {
	private surface: ResolvedSurface | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private video: HTMLVideoElement | null = null;
	private rVFCHandle = 0;
	private rAFHandle = 0;
	private destroyed = false;
	private params: VideoEnhanceParams = { strength: 0.5, scale: 1.5 };
	private errored = false;
	private onErrorCallback: ((err: Error) => void) | null = null;
	private firstFrameLogged = false;

	static isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'gpu' in navigator;
	}

	onError(cb: (err: Error) => void): void {
		this.onErrorCallback = cb;
	}

	async init(canvas: HTMLCanvasElement, video: HTMLVideoElement): Promise<boolean> {
		if (!VideoEnhanceEngine.isSupported()) return false;

		try {
			const adapter = await navigator.gpu.requestAdapter();
			if (!adapter) {
				this.reportError('No WebGPU adapter');
				return false;
			}
			const device = await adapter.requestDevice();
			if (this.destroyed) {
				device.destroy();
				return false;
			}

			device.lost.then((info) => {
				if (info.reason !== 'destroyed') {
					this.errored = true;
					this.reportError(`WebGPU device lost: ${info.message}`);
				}
			});

			// Surface async validation errors that would otherwise be silent.
			device.onuncapturederror = (event) => {
				this.errored = true;
				this.reportError(`WebGPU uncaptured error: ${event.error.message}`);
			};

			const context = canvas.getContext('webgpu');
			if (!context) {
				device.destroy();
				this.reportError('Failed to get webgpu canvas context');
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
						externalTexture: {},
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
				srcWidth: 0,
				srcHeight: 0,
			};

			this.writeParams();
			return true;
		} catch (err) {
			this.reportError(err instanceof Error ? err.message : String(err));
			return false;
		}
	}

	setParams(next: Partial<VideoEnhanceParams>): void {
		if (next.strength !== undefined) this.params.strength = next.strength;
		if (next.scale !== undefined) this.params.scale = next.scale;
		this.writeParams();
	}

	start(): void {
		if (!this.surface || !this.video || this.destroyed || this.errored) return;
		this.maybeResize();
		this.pump();
	}

	stop(): void {
		const v = this.video;
		if (v && this.rVFCHandle && 'cancelVideoFrameCallback' in v) {
			(v as any).cancelVideoFrameCallback(this.rVFCHandle);
		}
		if (this.rAFHandle) {
			window.cancelAnimationFrame(this.rAFHandle);
		}
		this.rVFCHandle = 0;
		this.rAFHandle = 0;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stop();
		if (this.surface) {
			this.surface.paramsBuffer.destroy();
			this.surface.device.destroy();
			this.surface = null;
		}
		this.canvas = null;
		this.video = null;
	}

	private reportError(msg: string): void {
		// eslint-disable-next-line no-console -- intentional, surface video-enhance failures
		console.warn('[VideoEnhanceEngine]', msg);
		this.onErrorCallback?.(new Error(msg));
	}

	private writeParams(): void {
		const s = this.surface;
		if (!s) return;
		const texelX = s.srcWidth > 0 ? 1 / s.srcWidth : 1 / 1920;
		const texelY = s.srcHeight > 0 ? 1 / s.srcHeight : 1 / 1080;
		const data = new Float32Array([texelX, texelY, this.params.strength, 0]);
		s.device.queue.writeBuffer(s.paramsBuffer, 0, data);
	}

	private maybeResize(): void {
		const s = this.surface;
		const canvas = this.canvas;
		const video = this.video;
		if (!s || !canvas || !video) return;

		const vw = video.videoWidth || 0;
		const vh = video.videoHeight || 0;
		if (vw === 0 || vh === 0) return;

		const targetW = Math.min(7680, Math.round(vw * this.params.scale));
		const targetH = Math.min(4320, Math.round(vh * this.params.scale));
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;

		if (s.srcWidth !== vw || s.srcHeight !== vh) {
			s.srcWidth = vw;
			s.srcHeight = vh;
			this.writeParams(); // texel sizes depend on source dimensions
		}
	}

	/**
	 * Render loop driver. Uses requestVideoFrameCallback when available so
	 * we tick exactly once per presented video frame; falls back to rAF for
	 * the case where rVFC isn't firing (rare browser quirks). A single
	 * rAF loop also guarantees the very first frame renders, in case
	 * rVFC has a slow startup before the first paint.
	 */
	private pump(): void {
		const v = this.video;
		if (!v || this.destroyed || this.errored) return;

		const tick = () => {
			if (this.destroyed || this.errored) return;
			this.renderFrame();
			this.scheduleNext();
		};
		this.scheduleNext(tick);
	}

	private scheduleNext(fn?: () => void): void {
		const v = this.video;
		if (!v || this.destroyed || this.errored) return;
		const cb =
			fn ??
			(() => {
				if (this.destroyed || this.errored) return;
				this.renderFrame();
				this.scheduleNext();
			});
		if ('requestVideoFrameCallback' in v) {
			this.rVFCHandle = (v as any).requestVideoFrameCallback(cb);
		} else {
			this.rAFHandle = window.requestAnimationFrame(cb);
		}
	}

	private renderFrame(): void {
		const s = this.surface;
		const video = this.video;
		if (!s || !video) return;
		if (video.readyState < 2 || !video.videoWidth) return;

		this.maybeResize();

		let extTex: GPUExternalTexture;
		try {
			// importExternalTexture is the zero-copy WebGPU path for video.
			// The resulting handle is only valid for this submit; we re-import
			// every frame.
			extTex = s.device.importExternalTexture({ source: video });
		} catch (err) {
			this.errored = true;
			this.reportError(
				err instanceof Error ? `importExternalTexture: ${err.message}` : 'import failed',
			);
			return;
		}

		const bindGroup = s.device.createBindGroup({
			layout: s.bindGroupLayout,
			entries: [
				{ binding: 0, resource: extTex },
				{ binding: 1, resource: s.sampler },
				{ binding: 2, resource: { buffer: s.paramsBuffer } },
			],
		});

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
		pass.setBindGroup(0, bindGroup);
		pass.draw(3, 1, 0, 0);
		pass.end();
		s.device.queue.submit([encoder.finish()]);

		if (!this.firstFrameLogged) {
			this.firstFrameLogged = true;
			// eslint-disable-next-line no-console -- one-time confirmation that the path is working
			console.info(
				`[VideoEnhanceEngine] first frame rendered (${s.srcWidth}×${s.srcHeight} → ${this.canvas?.width}×${this.canvas?.height})`,
			);
		}
	}
}
