import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { SAFE_INPUT_OPTIONS } from '../../common/ffmpeg-input.js';
import { videoBitDepth } from '../../common/video-probe.js';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, movies } from '../../database/schema/index.js';
import { TranscoderService } from '../transcoder/transcoder.service.js';

/** One playable video version of a movie, as shown in File Info → Video. */
export interface VideoVersion {
	/** `<fileId>`, `<fileId>:copy` (cached direct copy) or `<fileId>:original`. */
	id: string;
	fileId: string;
	kind: 'file' | 'copy' | 'original';
	fileName: string;
	codec: string | null;
	width: number | null;
	height: number | null;
	bitDepth: number | null;
	hdr: boolean;
	sizeBytes: number | null;
	/** The version that plays now (explicit default, else the automatic pick). */
	isDefault: boolean;
	/** True when an admin chose it (not the automatic pick). */
	explicit: boolean;
}

type CopyProbe = Pick<VideoVersion, 'codec' | 'width' | 'height' | 'bitDepth' | 'hdr'> & {
	sizeBytes: number;
};

/**
 * Per-movie playback defaults chosen on the movie page:
 *  - **video**: which file — and, for a file with a cached direct copy, the
 *    copy or the original — plays (`movies.default_video`);
 *  - **audio**: which audio track plays when the viewer hasn't picked one
 *    (`default: true` on the track in `movie_files.audio_tracks`).
 */
@Injectable()
export class PlayDefaultsService {
	private readonly copyProbes = new Map<string, CopyProbe>();

	constructor(
		private readonly database: DatabaseService,
		private readonly transcoder: TranscoderService,
	) {}

	private get db() {
		return this.database.db;
	}

	private defaultVideoOf(movieId: string | null | undefined): string | null {
		if (!movieId) return null;
		return (
			this.db
				.select({ v: movies.defaultVideo })
				.from(movies)
				.where(eq(movies.id, movieId))
				.get()?.v ?? null
		);
	}

	/** File id the admin pinned for this movie, if any. */
	preferredFileId(movieId: string | null | undefined): string | null {
		const v = this.defaultVideoOf(movieId);
		return v ? (v.split(':')[0] ?? null) : null;
	}

	/**
	 * The cached direct copy to serve for a file, or null to serve the source
	 * (no copy, or the admin chose the original version).
	 */
	servedCopy(file: { id: string; movieId?: string | null }): string | null {
		const copy = this.transcoder.getCachedDirectMp4(file.id);
		if (!copy) return null;
		const movieId = file.movieId ?? this.movieIdOfFile(file.id);
		return this.defaultVideoOf(movieId) === `${file.id}:original` ? null : copy;
	}

	private movieIdOfFile(fileId: string): string | null {
		return (
			this.db
				.select({ m: movieFiles.movieId })
				.from(movieFiles)
				.where(eq(movieFiles.id, fileId))
				.get()?.m ?? null
		);
	}

	/** Versions for File Info. `autoFileId` = the file the stream would pick. */
	versions(movieId: string, files: any[], autoFileId: string | null): VideoVersion[] {
		const stored = this.defaultVideoOf(movieId);
		const out: VideoVersion[] = [];
		for (const f of files) {
			const base = {
				fileId: f.id as string,
				fileName: String(f.fileName ?? ''),
				codec: f.codecVideo ?? null,
				width: f.videoWidth ?? null,
				height: f.videoHeight ?? null,
				bitDepth: f.videoBitDepth ?? null,
				hdr: !!f.hdr,
				sizeBytes: f.fileSize ?? null,
			};
			const copyPath = this.transcoder.getCachedDirectMp4(f.id);
			if (!copyPath) {
				out.push({ ...base, id: f.id, kind: 'file', isDefault: false, explicit: false });
				continue;
			}
			const probe = this.probeCopy(copyPath);
			out.push({
				...base,
				...(probe ?? {}),
				id: `${f.id}:copy`,
				kind: 'copy',
				isDefault: false,
				explicit: false,
			});
			out.push({ ...base, id: `${f.id}:original`, kind: 'original', isDefault: false, explicit: false });
		}
		const explicit = stored ? out.find((v) => v.id === stored || v.id === `${stored}:copy`) : undefined;
		const chosen =
			explicit ??
			out.find((v) => v.fileId === autoFileId && v.kind !== 'original') ??
			out[0];
		if (chosen) {
			chosen.isDefault = true;
			chosen.explicit = !!explicit;
		}
		return out;
	}

	setDefaultVideo(movieId: string, version: string | null): void {
		if (version != null) {
			const [fileId, kind] = version.split(':');
			const file = this.db.select().from(movieFiles).where(eq(movieFiles.id, fileId ?? '')).get();
			if (!file || file.movieId !== movieId) throw new NotFoundException('Version not found');
			if (kind && kind !== 'copy' && kind !== 'original') {
				throw new BadRequestException('Invalid version');
			}
		}
		const res = this.db
			.update(movies)
			.set({ defaultVideo: version })
			.where(eq(movies.id, movieId))
			.run();
		if (!res.changes) throw new NotFoundException('Movie not found');
		// Audio-track copies hold the video of whichever version was served
		// when they were built — drop them so they rebuild from the new one.
		for (const f of this.db
			.select({ id: movieFiles.id })
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.all()) {
			void this.transcoder.clearAudioVariants(f.id);
		}
	}

	/** Mark one audio track of a file as its default (clears the others). */
	setDefaultAudio(movieId: string, fileId: string, index: number): void {
		const file = this.db.select().from(movieFiles).where(eq(movieFiles.id, fileId)).get();
		if (!file || file.movieId !== movieId) throw new NotFoundException('File not found');
		let tracks: any[] = [];
		try {
			tracks = JSON.parse(file.audioTracks ?? '[]');
		} catch {
			tracks = [];
		}
		if (!Array.isArray(tracks) || !tracks.some((t, i) => (t.index ?? i) === index)) {
			throw new NotFoundException('Audio track not found');
		}
		const next = tracks.map((t, i) => ({ ...t, default: (t.index ?? i) === index }));
		this.db
			.update(movieFiles)
			.set({ audioTracks: JSON.stringify(next) })
			.where(eq(movieFiles.id, fileId))
			.run();
	}

	/** Codec/size of a cached copy (it has no DB row). Cached per path + mtime. */
	private probeCopy(p: string): CopyProbe | null {
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(p);
		} catch {
			return null;
		}
		const key = `${p}:${st.mtimeMs}`;
		const hit = this.copyProbes.get(key);
		if (hit) return hit;
		try {
			const out = execFileSync(
				'ffprobe',
				[
					...SAFE_INPUT_OPTIONS,
					'-v',
					'error',
					'-select_streams',
					'v:0',
					'-show_entries',
					'stream=codec_name,width,height,pix_fmt,bits_per_raw_sample,color_transfer',
					'-of',
					'json',
					`file:${p}`,
				],
				{ encoding: 'utf8', timeout: 15_000 },
			);
			const s = JSON.parse(out)?.streams?.[0] ?? {};
			const probe: CopyProbe = {
				codec: s.codec_name ?? null,
				width: s.width ?? null,
				height: s.height ?? null,
				bitDepth: videoBitDepth(s) ?? null,
				hdr: /smpte2084|arib-std-b67/.test(String(s.color_transfer ?? '')),
				sizeBytes: Number(st.size),
			};
			if (this.copyProbes.size > 200) this.copyProbes.clear();
			this.copyProbes.set(key, probe);
			return probe;
		} catch {
			return null;
		}
	}
}
