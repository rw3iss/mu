import { z } from 'zod';

export const loginSchema = z.object({
	username: z.string(),
	password: z.string().min(6),
});

export const setupSchema = z.object({
	username: z.string(),
	email: z.string().email().optional(),
	password: z.string().min(8),
	/** Movie folders (kind `video`). `mediaPath` is the legacy single-path form. */
	mediaPath: z.string().optional(),
	mediaPaths: z.array(z.string()).optional(),
	/** Feature flags chosen on the Setup "Libraries" step. */
	enableMovies: z.boolean().default(true),
	enableMusic: z.boolean().default(false),
	/** Music folders (kind `audio`). Only used when `enableMusic`. */
	musicPaths: z.array(z.string()).optional(),
});

export const refreshSchema = z.object({
	refreshToken: z.string(),
});

export type LoginDto = z.infer<typeof loginSchema>;
export type SetupDto = z.infer<typeof setupSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
