import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Public } from '../common/decorators/public.decorator.js';
import { ShareLinksService } from './share-links.service.js';

interface CreateShareLinkBody {
	movieId: string;
}

@Controller('share-links')
export class ShareLinksController {
	constructor(private readonly shareLinks: ShareLinksService) {}

	/**
	 * Create a share token + URL for a movie.
	 * Requires normal authentication (the global JwtAuthGuard covers this).
	 */
	@Post()
	create(@Body() body: CreateShareLinkBody, @Req() request: FastifyRequest) {
		if (!body?.movieId || typeof body.movieId !== 'string') {
			throw new BadRequestException('movieId is required');
		}
		const result = this.shareLinks.createShareToken(body.movieId, (request as any).server);
		return {
			token: result.token,
			movieId: result.movieId,
			expiresInDays: result.expiresInDays,
		};
	}

	/**
	 * Verify a share token without authentication.
	 * Used by the client's /watch/:token page to pre-flight before mounting the player.
	 */
	@Get('verify/:token')
	@Public()
	verify(@Param('token') token: string, @Req() request: FastifyRequest) {
		const payload = this.shareLinks.verifyShareToken(token, (request as any).server);
		if (!payload) {
			return { valid: false };
		}
		return { valid: true, movieId: payload.movieId };
	}
}
