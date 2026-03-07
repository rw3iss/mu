import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string(),
  password: z.string().min(6),
});

export const setupSchema = z.object({
  username: z.string(),
  email: z.string().email().optional(),
  password: z.string().min(8),
});

export const refreshSchema = z.object({
  refreshToken: z.string(),
});

export type LoginDto = z.infer<typeof loginSchema>;
export type SetupDto = z.infer<typeof setupSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
