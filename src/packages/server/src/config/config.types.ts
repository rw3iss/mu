import { z } from 'zod';
import { configSchema } from './config.schema.js';

export type MuConfig = z.infer<typeof configSchema>;
