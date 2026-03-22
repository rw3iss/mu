import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
	constructor(private schema: ZodSchema) {}

	transform(value: unknown) {
		const result = this.schema.safeParse(value);
		if (!result.success) {
			const issues = (result.error.issues ?? (result.error as any).errors ?? []).map(
				(e: any) => ({
					path: e.path.join('.'),
					message: e.message,
				}),
			);
			throw new BadRequestException({ message: 'Validation failed', errors: issues });
		}
		return result.data;
	}
}
