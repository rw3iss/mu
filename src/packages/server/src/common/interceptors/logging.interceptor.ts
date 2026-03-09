import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger('HTTP');

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const request = context.switchToHttp().getRequest();
		const { method, url } = request;
		const start = Date.now();

		return next.handle().pipe(
			tap(() => {
				const reply = context.switchToHttp().getResponse();
				const duration = Date.now() - start;
				this.logger.log(`${method} ${url} ${reply.statusCode} ${duration}ms`);
			}),
		);
	}
}
