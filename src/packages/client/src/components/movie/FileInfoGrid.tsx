import type { Movie } from '@/state/library.state';
import { getStreamModeLabel, needsTranscode } from '@/utils/stream-mode';
import styles from './FileInfoGrid.module.scss';

interface FileInfoGridProps {
	movie: Movie;
	/** Use dark-on-dark palette for player flyout panels */
	dark?: boolean;
}

export function FileInfoGrid({ movie, dark }: FileInfoGridProps) {
	const fi = movie.fileInfo;
	if (!fi) return null;

	const wrapClass = dark ? `${styles.wrap} ${styles.dark}` : styles.wrap;

	return (
		<div class={wrapClass}>
			<div class={styles.grid}>
				<span class={styles.label}>Playback</span>
				<span class={styles.value}>
					<span
						class={`${styles.badge} ${
							needsTranscode(movie) ? styles.badgeWarn : styles.badgeSuccess
						}`}
					>
						{getStreamModeLabel(movie) ?? 'Unknown'}
					</span>
				</span>

				{fi.fileName && (
					<>
						<span class={styles.label}>File</span>
						<span class={styles.value}>{fi.fileName}</span>
					</>
				)}
				{fi.containerFormat && (
					<>
						<span class={styles.label}>Container</span>
						<span class={styles.value}>{fi.containerFormat}</span>
					</>
				)}
				{(fi.videoWidth || fi.resolution) && (
					<>
						<span class={styles.label}>Resolution</span>
						<span class={styles.value}>
							{fi.videoWidth && fi.videoHeight
								? `${fi.videoWidth}x${fi.videoHeight}`
								: ''}{' '}
							{fi.resolution ? `(${fi.resolution})` : ''}
						</span>
					</>
				)}
				{fi.codecVideo && (
					<>
						<span class={styles.label}>Video Codec</span>
						<span class={styles.value}>
							{fi.codecVideo.toUpperCase()}
							{fi.videoProfile ? ` ${fi.videoProfile}` : ''}
						</span>
					</>
				)}
				{fi.videoBitDepth && (
					<>
						<span class={styles.label}>Bit Depth</span>
						<span class={styles.value}>
							{fi.videoBitDepth}-bit
							{fi.hdr && <span class={styles.badge}>HDR</span>}
						</span>
					</>
				)}
				{fi.videoFrameRate && (
					<>
						<span class={styles.label}>Frame Rate</span>
						<span class={styles.value}>
							{parseFloat(fi.videoFrameRate).toFixed(
								Number.isInteger(parseFloat(fi.videoFrameRate)) ? 0 : 3,
							)}{' '}
							fps
						</span>
					</>
				)}
				{fi.bitrate != null && fi.bitrate > 0 && (
					<>
						<span class={styles.label}>Bitrate</span>
						<span class={styles.value}>{(fi.bitrate / 1_000_000).toFixed(1)} Mbps</span>
					</>
				)}
				{fi.fileSize != null && fi.fileSize > 0 && (
					<>
						<span class={styles.label}>File Size</span>
						<span class={styles.value}>
							{fi.fileSize > 1_073_741_824
								? `${(fi.fileSize / 1_073_741_824).toFixed(2)} GB`
								: `${(fi.fileSize / 1_048_576).toFixed(0)} MB`}
						</span>
					</>
				)}
				{fi.videoColorSpace && (
					<>
						<span class={styles.label}>Color Space</span>
						<span class={styles.value}>{fi.videoColorSpace}</span>
					</>
				)}
			</div>

			{fi.audioTracks && fi.audioTracks.length > 0 && (
				<div class={styles.trackSection}>
					<h3 class={styles.trackTitle}>Audio Tracks ({fi.audioTracks.length})</h3>
					<div class={styles.trackList}>
						{fi.audioTracks.map((t) => (
							<div key={t.index} class={styles.trackItem}>
								<span class={styles.trackCodec}>{t.codec.toUpperCase()}</span>
								<span class={styles.trackMeta}>
									{t.channelLayout || (t.channels ? `${t.channels}ch` : '')}
								</span>
								<span class={styles.trackLang}>
									{t.language !== 'und' ? t.language?.toUpperCase() : ''}
								</span>
								{t.title && t.title !== `Track ${t.index + 1}` && (
									<span class={styles.trackExtra}>{t.title}</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
