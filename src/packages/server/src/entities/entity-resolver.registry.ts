import { type EntityRef, type EntityType, isEntityType } from '@mu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';

export interface EntitySummary {
	title: string;
	imageUrl: string | null;
	/** Client route for the entity (e.g. `/movie/<id>`). */
	url: string;
}

/**
 * Answers "does it exist, what is it called" for one entity type. Feature
 * modules register theirs in `onModuleInit`, so generic entity services never
 * import a feature module.
 */
export interface EntityResolver {
	exists(id: string): Promise<boolean>;
	summary(id: string): Promise<EntitySummary | null>;
	/**
	 * Optional: the type's own list-row objects (e.g. AlbumSummary) by id, for
	 * views that render rich cards (favourites). Missing ids are absent.
	 */
	cards?(ids: string[], userId?: string): Promise<Map<string, unknown>>;
}

@Injectable()
export class EntityResolverRegistry {
	private readonly resolvers = new Map<EntityType, EntityResolver>();

	register(type: EntityType, resolver: EntityResolver): void {
		this.resolvers.set(type, resolver);
	}

	get(type: EntityType): EntityResolver | undefined {
		return this.resolvers.get(type);
	}

	has(type: EntityType): boolean {
		return this.resolvers.has(type);
	}

	async exists(ref: EntityRef): Promise<boolean> {
		const r = this.resolvers.get(ref.type);
		return r ? r.exists(ref.id) : false;
	}

	async summary(ref: EntityRef): Promise<EntitySummary | null> {
		const r = this.resolvers.get(ref.type);
		return r ? r.summary(ref.id) : null;
	}

	/**
	 * Validate a raw (type, id) pair from a route. Throws 404 for an unknown
	 * type, a type with no registered resolver, or a missing entity.
	 */
	async require(type: string, id: string): Promise<EntityRef> {
		if (!isEntityType(type) || !this.resolvers.has(type) || !id) {
			throw new NotFoundException(`Unknown entity type: ${type}`);
		}
		const ref: EntityRef = { type, id };
		if (!(await this.exists(ref))) {
			throw new NotFoundException(`${type} not found`);
		}
		return ref;
	}
}
