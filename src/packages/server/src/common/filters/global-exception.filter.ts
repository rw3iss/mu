import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger('ExceptionFilter');

	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp();
		const reply = ctx.getResponse<FastifyReply>();

		let status = HttpStatus.INTERNAL_SERVER_ERROR;
		let message = 'Internal server error';
		let error: string | undefined;

		if (exception instanceof HttpException) {
			status = exception.getStatus();
			const response = exception.getResponse();
			if (typeof response === 'string') {
				message = response;
			} else if (typeof response === 'object' && response !== null) {
				const resp = response as Record<string, unknown>;
				message = (resp.message as string) ?? message;
				error = resp.error as string | undefined;
			}
		} else if (exception instanceof Error) {
			message = exception.message;
			this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
		}

		reply.status(status).send({
			statusCode: status,
			message,
			error,
			timestamp: new Date().toISOString(),
		});
	}
}
