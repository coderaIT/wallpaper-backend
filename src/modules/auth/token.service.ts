import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Admin, Prisma } from '../../generated/prisma/client';
import { AppConfigService } from '../../config/app-config.type';
import { EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenPayload } from './interfaces/authenticated-admin.interface';

export interface IssuedRefreshToken {
  /** Opaque value sent to the browser: `<tokenId>.<secret>`. Never persisted. */
  value: string;
  id: string;
  familyId: string;
  expiresAt: Date;
}

export type RefreshValidation =
  | { status: 'valid'; tokenId: string; familyId: string; adminId: string }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'reused'; familyId: string; adminId: string }
  | { status: 'race'; adminId: string };

/** A rotated token presented again within this window is treated as a concurrent-refresh race, not theft. */
const ROTATION_GRACE_MS = 15_000;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private get cfg(): AppConfigService {
    return this.config;
  }

  get accessTokenTtlSeconds(): number {
    return this.cfg.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  signAccessToken(admin: Pick<Admin, 'id' | 'role' | 'tokenVersion'>): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: admin.id,
      role: admin.role,
      ver: admin.tokenVersion,
    };
    return this.jwt.signAsync(payload, {
      secret: this.cfg.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.accessTokenTtlSeconds,
      issuer: this.cfg.get('JWT_ISSUER', { infer: true }),
      audience: this.cfg.get('JWT_AUDIENCE', { infer: true }),
      algorithm: 'HS256',
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.cfg.get('JWT_ACCESS_SECRET', { infer: true }),
        issuer: this.cfg.get('JWT_ISSUER', { infer: true }),
        audience: this.cfg.get('JWT_AUDIENCE', { infer: true }),
        algorithms: ['HS256'],
      });
      return typeof payload.sub === 'string' && Number.isInteger(payload.ver) ? payload : null;
    } catch {
      return null;
    }
  }

  async issueRefreshToken(
    adminId: string,
    opts: { familyId?: string; userAgent?: string | null },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedRefreshToken> {
    const secret = randomBytes(32).toString('base64url');
    const familyId = opts.familyId ?? randomUUID();
    const expiresAt = new Date(
      Date.now() + this.cfg.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
    );
    const row = await tx.refreshToken.create({
      data: {
        adminId,
        familyId,
        tokenHash: sha256(secret),
        expiresAt,
        userAgent: opts.userAgent ?? null,
      },
      select: { id: true },
    });
    return { value: `${row.id}.${secret}`, id: row.id, familyId, expiresAt };
  }

  /** Validates a presented refresh token without mutating state. */
  async validateRefreshToken(value: string | undefined): Promise<RefreshValidation> {
    const parsed = parseRefreshToken(value);
    if (!parsed) return { status: 'invalid' };
    const row = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } });
    if (!row || !safeEqualHex(row.tokenHash, sha256(parsed.secret))) return { status: 'invalid' };
    if (row.revokedAt) {
      // Only a *rotated* token being replayed indicates theft; logged-out/revoked tokens are simply invalid.
      if (row.revokedReason !== 'ROTATED') return { status: 'invalid' };
      if (Date.now() - row.revokedAt.getTime() < ROTATION_GRACE_MS) {
        return { status: 'race', adminId: row.adminId };
      }
      return { status: 'reused', familyId: row.familyId, adminId: row.adminId };
    }
    if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    return { status: 'valid', tokenId: row.id, familyId: row.familyId, adminId: row.adminId };
  }

  /**
   * Atomically marks the old token as rotated and issues its successor in the same family.
   * Returns null if another request rotated the token first.
   */
  async rotate(
    tokenId: string,
    familyId: string,
    adminId: string,
    userAgent: string | null,
  ): Promise<IssuedRefreshToken | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: tokenId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });
      if (claimed.count !== 1) return null;
      const next = await this.issueRefreshToken(adminId, { familyId, userAgent }, tx);
      await tx.refreshToken.update({ where: { id: tokenId }, data: { replacedById: next.id } });
      return next;
    });
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForAdmin(
    adminId: string,
    reason: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Housekeeping: drop tokens that expired more than a day ago. */
  async purgeExpired(adminId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { adminId, expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
    });
  }

  /**
   * CSRF token bound to the refresh token (signed double-submit): HMAC of the refresh token
   * id. A cross-site attacker can neither read it nor derive it.
   */
  csrfTokenFor(refreshTokenValue: string): string {
    const parsed = parseRefreshToken(refreshTokenValue);
    const subject = parsed ? parsed.id : 'invalid';
    return createHmac('sha256', this.cfg.get('JWT_ACCESS_SECRET', { infer: true }))
      .update(`csrf:${subject}`)
      .digest('base64url');
  }

  verifyCsrfToken(refreshTokenValue: string | undefined, presented: string | undefined): boolean {
    if (!refreshTokenValue || !presented || !parseRefreshToken(refreshTokenValue)) return false;
    const expected = Buffer.from(this.csrfTokenFor(refreshTokenValue));
    const given = Buffer.from(presented);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRefreshToken(value: string | undefined): { id: string; secret: string } | null {
  if (!value || value.length > 200) return null;
  const idx = value.indexOf('.');
  if (idx <= 0) return null;
  const id = value.slice(0, idx);
  const secret = value.slice(idx + 1);
  if (!UUID_RE.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id, secret };
}
