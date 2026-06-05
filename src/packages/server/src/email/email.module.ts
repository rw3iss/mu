import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';

/**
 * Outbound email. Global so any feature (currently: feedback notifications) can
 * inject {@link EmailService} without wiring imports. ConfigService is global too.
 */
@Global()
@Module({
	providers: [EmailService],
	exports: [EmailService],
})
export class EmailModule {}
