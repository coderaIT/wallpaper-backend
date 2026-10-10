import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { hashPassword, validatePasswordStrength } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import {
  AdminResponseDto,
  CreateAdminDto,
  ListAdminsQueryDto,
  UpdateAdminDto,
} from './dto/admin.dto';

/** Never select passwordHash or lockout internals into API responses. */
export const ADMIN_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminSelect;

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: ListAdminsQueryDto): Promise<Paginated<AdminResponseDto>> {
    const where: Prisma.AdminWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.admin.findMany({
        where,
        select: ADMIN_PUBLIC_SELECT,
        orderBy: { createdAt: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.admin.count({ where }),
    ]);
    return Paginated.of(items, total, query.page, query.limit);
  }

  async get(id: string): Promise<AdminResponseDto> {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      select: ADMIN_PUBLIC_SELECT,
    });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  async create(
    dto: CreateAdminDto,
    actor: AuthenticatedAdmin,
    meta: RequestMeta,
  ): Promise<AdminResponseDto> {
    const problem = validatePasswordStrength(dto.password);
    if (problem) throw new BadRequestException(`Password ${problem}`);
    const exists = await this.prisma.admin.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (exists) throw new ConflictException('An admin with this email already exists');

    const admin = await this.prisma.admin.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        passwordHash: await hashPassword(dto.password),
      },
      select: ADMIN_PUBLIC_SELECT,
    });
    await this.audit.record({
      adminId: actor.id,
      action: AuditAction.AdminCreated,
      entityType: AuditEntity.Admin,
      entityId: admin.id,
      metadata: { email: admin.email, role: admin.role },
      meta,
    });
    return admin;
  }

  async update(
    id: string,
    dto: UpdateAdminDto,
    actor: AuthenticatedAdmin,
    meta: RequestMeta,
  ): Promise<AdminResponseDto> {
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Admin not found');

    if (id === actor.id && (dto.isActive === false || (dto.role && dto.role !== target.role))) {
      throw new BadRequestException('You cannot disable your own account or change your own role');
    }
    const losesSuperAdmin =
      target.role === 'SUPER_ADMIN' &&
      target.isActive &&
      ((dto.role !== undefined && dto.role !== 'SUPER_ADMIN') || dto.isActive === false);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (losesSuperAdmin) await this.assertAnotherActiveSuperAdmin(tx, id);
      const admin = await tx.admin.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: ADMIN_PUBLIC_SELECT,
      });
      if (dto.isActive === false) await this.tokens.revokeAllForAdmin(id, 'ADMIN_DISABLED', tx);
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.AdminUpdated,
          entityType: AuditEntity.Admin,
          entityId: id,
          metadata: { changes: dto },
          meta,
        },
        tx,
      );
      return admin;
    });
    return updated;
  }

  async resetPassword(
    id: string,
    newPassword: string,
    actor: AuthenticatedAdmin,
    meta: RequestMeta,
  ): Promise<void> {
    const problem = validatePasswordStrength(newPassword);
    if (problem) throw new BadRequestException(`Password ${problem}`);
    const exists = await this.prisma.admin.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Admin not found');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
        },
      });
      await this.tokens.revokeAllForAdmin(id, 'PASSWORD_RESET', tx);
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.AdminPasswordReset,
          entityType: AuditEntity.Admin,
          entityId: id,
          meta,
        },
        tx,
      );
    });
  }

  async remove(id: string, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    if (id === actor.id) throw new BadRequestException('You cannot delete your own account');
    const target = await this.prisma.admin.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Admin not found');
    await this.prisma.$transaction(async (tx) => {
      if (target.role === 'SUPER_ADMIN' && target.isActive)
        await this.assertAnotherActiveSuperAdmin(tx, id);
      await tx.admin.delete({ where: { id } });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.AdminDeleted,
          entityType: AuditEntity.Admin,
          entityId: id,
          metadata: { email: target.email },
          meta,
        },
        tx,
      );
    });
  }

  private async assertAnotherActiveSuperAdmin(
    tx: Prisma.TransactionClient,
    excludeId: string,
  ): Promise<void> {
    const others = await tx.admin.count({
      where: { role: 'SUPER_ADMIN', isActive: true, id: { not: excludeId } },
    });
    if (others === 0) throw new BadRequestException('At least one active SUPER_ADMIN must remain');
  }
}
