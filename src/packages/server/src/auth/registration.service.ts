import crypto from 'node:crypto';
import {
	DEFAULT_REGISTRATION_CONFIG,
	nowISO,
	type RegistrationConfig,
	type RegistrationResult,
	type RegistrationStatus,
	validatePassword,
} from '@mu/shared';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { users } from '../database/schema/index.js';
import { EmailService } from '../email/email.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { RegisterDto } from './dto/register.dto.js';

/** App-settings keys backing the three admin switches. */
const ALLOW_KEY = 'registrationAllow';
const APPROVAL_KEY = 'registrationRequireApproval';
const VERIFY_KEY = 'registrationRequireEmailVerification';

/**
 * Public self-registration: the admin config, account creation, and email
 * verification.
 *
 * Split out of AuthService (which owns login/setup/tokens) so each service has
 * one responsibility. Login-time enforcement of the gates this sets lives in
 * AuthService.login — this service only decides what a NEW account starts as.
 */
@Injectable()
export class RegistrationService {
	private readonly logger = new Logger('RegistrationService');

	constructor(
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly email: EmailService,
	) {}

	// ── Admin config ──────────────────────────────────────────────────────

	getConfig(): RegistrationConfig {
		return {
			allowRegistration:
				this.settings.get<boolean>(
					ALLOW_KEY,
					DEFAULT_REGISTRATION_CONFIG.allowRegistration,
				) === true,
			requireApproval:
				this.settings.get<boolean>(
					APPROVAL_KEY,
					DEFAULT_REGISTRATION_CONFIG.requireApproval,
				) === true,
			requireEmailVerification:
				this.settings.get<boolean>(
					VERIFY_KEY,
					DEFAULT_REGISTRATION_CONFIG.requireEmailVerification,
				) === true,
		};
	}

	setConfig(config: RegistrationConfig): RegistrationConfig {
		this.settings.set(ALLOW_KEY, !!config.allowRegistration);
		this.settings.set(APPROVAL_KEY, !!config.requireApproval);
		this.settings.set(VERIFY_KEY, !!config.requireEmailVerification);
		return this.getConfig();
	}

	// ── Registration ──────────────────────────────────────────────────────

	async register(data: RegisterDto): Promise<RegistrationResult> {
		const config = this.getConfig();
		if (!config.allowRegistration) {
			throw new BadRequestException('Registration is not enabled on this server.');
		}

		// Enforce the SHARED policy (the DTO only checks length/shape), so the
		// rules the register form advertises are exactly the ones applied here.
		const passwordError = validatePassword(data.password);
		if (passwordError) throw new BadRequestException(passwordError);

		const username = data.username.trim();
		const email = data.email.trim();

		// Uniqueness is reported per-field so the form can point at the right
		// input. Case-insensitive: usernames/emails differing only by case would
		// be indistinguishable to a human.
		if (this.findByUsername(username)) {
			throw new ConflictException('That username is already taken.');
		}
		if (this.findByEmail(email)) {
			throw new ConflictException('An account with that email address already exists.');
		}

		const requireVerification = config.requireEmailVerification;
		const requireApproval = config.requireApproval;
		const verificationToken = requireVerification
			? crypto.randomBytes(32).toString('hex')
			: null;
		const now = nowISO();

		try {
			this.database.db
				.insert(users)
				.values({
					id: crypto.randomUUID(),
					username,
					email,
					displayName: data.displayName?.trim() || null,
					passwordHash: await bcrypt.hash(data.password, 12),
					// Self-registered users always start at the lowest privilege.
					role: 'viewer',
					profilePublic: true,
					approved: !requireApproval,
					emailVerified: !requireVerification,
					verificationToken,
					verificationSentAt: verificationToken ? now : null,
					createdAt: now,
					updatedAt: now,
				})
				.run();
		} catch (err: any) {
			// Unique-index race between the checks above and the insert.
			if (String(err?.message ?? '').includes('UNIQUE')) {
				throw new ConflictException(
					'That username or email address is already registered.',
				);
			}
			throw err;
		}

		if (verificationToken) {
			// Best-effort: a mail failure must not undo a created account. The
			// admin can still approve/verify from Settings → Users.
			void this.email
				.sendVerificationEmail({ to: email, username, token: verificationToken })
				.catch((err) =>
					this.logger.warn(
						`Verification email failed for ${email}: ${err?.message ?? err}`,
					),
				);
		}

		const status: RegistrationStatus =
			requireVerification && requireApproval
				? 'pending-verification-and-approval'
				: requireVerification
					? 'pending-verification'
					: requireApproval
						? 'pending-approval'
						: 'active';

		this.logger.log(`New account registered: ${username} (${status})`);
		return { status, username, message: MESSAGES[status] };
	}

	/** Consume a verification token. Idempotent-ish: an unknown token is a 400. */
	async verifyEmail(token: string): Promise<{ verified: boolean; pendingApproval: boolean }> {
		const clean = (token ?? '').trim();
		if (!clean) throw new BadRequestException('Missing verification token.');

		const user = this.database.db
			.select()
			.from(users)
			.where(eq(users.verificationToken, clean))
			.get();
		if (!user) {
			throw new BadRequestException(
				'That verification link is invalid or has already been used.',
			);
		}

		this.database.db
			.update(users)
			.set({ emailVerified: true, verificationToken: null, updatedAt: nowISO() })
			.where(eq(users.id, user.id))
			.run();

		this.logger.log(`Email verified for ${user.username}`);
		return { verified: true, pendingApproval: !user.approved };
	}

	// ── Lookups (case-insensitive) ────────────────────────────────────────

	private findByUsername(username: string) {
		return this.database.db
			.select({ id: users.id })
			.from(users)
			.where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
			.get();
	}

	private findByEmail(email: string) {
		return this.database.db
			.select({ id: users.id })
			.from(users)
			.where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
			.get();
	}
}

/** Confirmation copy per outcome — rendered verbatim by the register page. */
const MESSAGES: Record<RegistrationStatus, string> = {
	active: 'Your account is ready. You can sign in now.',
	'pending-approval':
		'Your account was created and is waiting for an administrator to approve it. You’ll be able to sign in once it’s approved.',
	'pending-verification':
		'Check your email for a verification link — you’ll need to verify your address before you can sign in.',
	'pending-verification-and-approval':
		'Check your email for a verification link. Once verified, an administrator still needs to approve your account before you can sign in.',
};
