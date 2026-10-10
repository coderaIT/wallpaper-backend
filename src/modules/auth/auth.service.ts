import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AdminProfileDto } from './dto/auth.dto';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password.util';
import { IssuedRefreshToken, TokenService } from './token.service';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const INVALID_CREDENTIALS = 'Invalid email or password';

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: IssuedRefreshToken;
  admin: AdminProfileDto;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash of a random password; verifying against it equalizes timing for unknown emails. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditLogsService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<AuthSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await this.prisma.admin.findUnique({ where: { email: normalizedEmail } });

    if (!admin) {
      this.dummyHash ??= hashPassword(`dummy-${Date.now()}-${Math.random()}`);
      await verifyPassword(await this.dummyHash, password);
      await this.audit.record({
        adminId: null,
        action: AuditAction.AuthLoginFailed,
        entityType: AuditEntity.Auth,
        metadata: { email: normalizedEmail, reason: 'UNKNOWN_EMAIL' },
        meta,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      await this.audit.record({
        adminId: admin.id,
        action: AuditAction.AuthLoginFailed,
        entityType: AuditEntity.Auth,
        entityId: admin.id,
        metadata: { reason: 'LOCKED' },
        meta,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const ok = await verifyPassword(admin.passwordHash, password);
    if (!ok) {
      const attempts = admin.failedLoginAttempts + 1;
      const lock = attempts >= MAX_FAILED_LOGINS;
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: lock
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
          : { failedLoginAttempts: attempts },
      });
      await this.audit.record({
        adminId: admin.id,
        action: lock ? AuditAction.AuthAccountLocked : AuditAction.AuthLoginFailed,
        entityType: AuditEntity.Auth,
        entityId: admin.id,
        metadata: { reason: 'BAD_PASSWORD', attempts },
        meta,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!admin.isActive) {
      await this.audit.record({
        adminId: admin.id,
        action: AuditAction.AuthLoginFailed,
        entityType: AuditEntity.Auth,
        entityId: admin.id,
        metadata: { reason: 'DISABLED' },
        meta,
      });
      throw new ForbiddenException('Account is disabled');
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.tokens.purgeExpired(admin.id);
    const refreshToken = await this.tokens.issueRefreshToken(admin.id, {
      userAgent: meta.userAgent,
    });
    const accessToken = await this.tokens.signAccessToken(admin);

    await this.audit.record({
      adminId: admin.id,
      action: AuditAction.AuthLogin,
      entityType: AuditEntity.Auth,
      entityId: admin.id,
      meta,
    });

    return {
      accessToken,
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    };
  }

  async refresh(refreshTokenValue: string | undefined, meta: RequestMeta): Promise<AuthSession> {
    const result = await this.tokens.validateRefreshToken(refreshTokenValue);
    switch (result.status) {
      case 'invalid':
      case 'expired':
        throw new UnauthorizedException('Invalid or expired refresh token');
      case 'race':
        throw new UnauthorizedException('Refresh token already used');
      case 'reused':
        await this.tokens.revokeFamily(result.familyId, 'REUSE_DETECTED');
        this.logger.warn(
          `Refresh token reuse detected for admin ${result.adminId}; session family revoked`,
        );
        await this.audit.record({
          adminId: result.adminId,
          action: AuditAction.AuthRefreshTokenReuse,
          entityType: AuditEntity.Auth,
          entityId: result.adminId,
          metadata: { familyId: result.familyId },
          meta,
        });
        throw new UnauthorizedException('Invalid or expired refresh token');
      case 'valid':
        break;
    }

    const admin = await this.prisma.admin.findUnique({ where: { id: result.adminId } });
    if (!admin || !admin.isActive) {
      await this.tokens.revokeFamily(result.familyId, 'ADMIN_DISABLED');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const next = await this.tokens.rotate(
      result.tokenId,
      result.familyId,
      admin.id,
      meta.userAgent,
    );
    if (!next) throw new UnauthorizedException('Refresh token already used');

    return {
      accessToken: await this.tokens.signAccessToken(admin),
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken: next,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    };
  }

  async logout(refreshTokenValue: string | undefined, meta: RequestMeta): Promise<void> {
    const result = await this.tokens.validateRefreshToken(refreshTokenValue);
    if (result.status === 'valid' || result.status === 'race') {
      const adminId = result.adminId;
      if (result.status === 'valid') await this.tokens.revokeFamily(result.familyId, 'LOGOUT');
      await this.audit.record({
        adminId,
        action: AuditAction.AuthLogout,
        entityType: AuditEntity.Auth,
        entityId: adminId,
        meta,
      });
    }
  }

  async getProfile(adminId: string): Promise<AdminProfileDto> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!admin) throw new UnauthorizedException('Authentication required');
    return admin;
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException('Authentication required');
    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const problem = validatePasswordStrength(newPassword);
    if (problem) throw new BadRequestException(`New password ${problem}`);
    if (await verifyPassword(admin.passwordHash, newPassword)) {
      throw new BadRequestException('New password must differ from the current password');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: adminId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await this.tokens.revokeAllForAdmin(adminId, 'PASSWORD_CHANGED', tx);
      await this.audit.record(
        {
          adminId,
          action: AuditAction.AuthPasswordChanged,
          entityType: AuditEntity.Admin,
          entityId: adminId,
          meta,
        },
        tx,
      );
    });
  }
}
