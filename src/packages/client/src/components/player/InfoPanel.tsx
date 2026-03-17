import { useState } from 'preact/hooks';
import { FileInfoGrid } from '@/components/movie/FileInfoGrid';
import { PluginSlot } from '@/plugins/PluginSlot';
import { UI } from '@/plugins/ui-slots';
import type { Movie } from '@/state/library.state';
import styles from './InfoPanel.module.scss';

interface InfoPanelProps {
	movie: Movie | null;
	visible: boolean;
	onClose: () => void;
}

export function InfoPanel({ movie, visible, onClose }: InfoPanelProps) {
	const [showFileInfo, setShowFileInfo] = useState(false);

	if (!movie) return null;

	const hours = Math.floor((movie.runtime ?? 0) / 60);
	const minutes = (movie.runtime ?? 0) % 60;
	const runtimeText = movie.runtime ? `${hours > 0 ? `${hours}h ` : ''}${minutes}m` : '';

	return (
		<>
			{/* Backdrop overlay */}
			{visible && <div class={styles.backdrop} onClick={onClose} />}

			<div class={`${styles.panel} ${visible ? styles.open : ''}`} data-player-panel>
				<button class={styles.closeBtn} onClick={onClose} aria-label="Close info">
					{'\u2715'}
				</button>

				{/* Poster */}
				{movie.posterUrl && (
					<img
						src={movie.posterUrl}
						alt={`${movie.title} poster`}
						class={styles.poster}
					/>
				)}

				<h2 class={styles.title}>{movie.title}</h2>

				<div class={styles.meta}>
					{movie.year > 0 && <span>{movie.year}</span>}
					{runtimeText && <span>{runtimeText}</span>}
					{movie.director && <span>Dir. {movie.director}</span>}
				</div>

				{/* Genres */}
				{movie.genres && movie.genres.length > 0 && (
					<div class={styles.genres}>
						{movie.genres.map((genre) => (
							<span key={genre} class={styles.genreTag}>
								{genre}
							</span>
						))}
					</div>
				)}

				{/* Ratings */}
				<div class={styles.ratings}>
					{movie.imdbRating != null && movie.imdbRating > 0 && (
						<div class={styles.ratingItem}>
							<span class={styles.ratingSource}>IMDb</span>
							<span class={styles.ratingValue}>{movie.imdbRating}</span>
						</div>
					)}
					{movie.rtRating != null && movie.rtRating > 0 && (
						<div class={styles.ratingItem}>
							<span class={styles.ratingSource}>RT</span>
							<span class={styles.ratingValue}>{movie.rtRating}%</span>
						</div>
					)}
					{movie.metacriticRating != null && movie.metacriticRating > 0 && (
						<div class={styles.ratingItem}>
							<span class={styles.ratingSource}>Metacritic</span>
							<span class={styles.ratingValue}>{movie.metacriticRating}</span>
						</div>
					)}
				</div>

				{/* Overview */}
				{movie.overview && (
					<div class={styles.section}>
						<h3 class={styles.sectionTitle}>Overview</h3>
						<p class={styles.overview}>{movie.overview}</p>
					</div>
				)}

				{/* Cast */}
				{movie.cast && movie.cast.length > 0 && (
					<div class={styles.section}>
						<h3 class={styles.sectionTitle}>Cast</h3>
						<div class={styles.castList}>
							{movie.cast.slice(0, 8).map((member) => (
								<div key={member.name} class={styles.castMember}>
									<span class={styles.castName}>{member.name}</span>
									{member.character && (
										<span class={styles.castCharacter}>{member.character}</span>
									)}
								</div>
							))}
						</div>
					</div>
				)}

				{/* File Info */}
				{movie.fileInfo && (
					<div class={styles.section}>
						<button
							class={styles.fileInfoToggle}
							onClick={() => setShowFileInfo(!showFileInfo)}
						>
							<h3 class={styles.sectionTitle}>File Info</h3>
							<span class={styles.fileInfoArrow}>
								{showFileInfo ? '\u25B2' : '\u25BC'}
							</span>
						</button>
						{showFileInfo && <FileInfoGrid movie={movie} dark />}
					</div>
				)}

				{/* Plugin UI Slots */}
				<PluginSlot name={UI.INFO_PANEL} context={{ movie }} />
			</div>
		</>
	);
}
