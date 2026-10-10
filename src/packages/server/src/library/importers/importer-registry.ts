import type { MediaKind } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { MediaImporter } from './media-importer.js';

/**
 * MediaKind → MediaImporter. Importers register themselves at module init
 * (VideoImporter in LibraryModule; AudioImporter later in MusicModule). A kind
 * with no registered importer is simply not scanned or watched.
 */
@Injectable()
export class ImporterRegistry {
	private readonly logger = new Logger('ImporterRegistry');
	private readonly importers = new Map<MediaKind, MediaImporter>();

	register(importer: MediaImporter): void {
		if (this.importers.has(importer.kind)) {
			this.logger.warn(`Replacing importer for kind "${importer.kind}"`);
		}
		this.importers.set(importer.kind, importer);
		this.logger.log(`Importer registered: ${importer.kind}`);
	}

	get(kind: MediaKind | string | null | undefined): MediaImporter | undefined {
		return this.importers.get((kind || 'video') as MediaKind);
	}

	has(kind: MediaKind | string | null | undefined): boolean {
		return this.importers.has((kind || 'video') as MediaKind);
	}

	list(): MediaImporter[] {
		return [...this.importers.values()];
	}
}
