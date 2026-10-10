import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditActionValue, AuditEntityValue } from './audit-actions';
import { sanitizeAuditMetadata } from './audit-sanitizer';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query.dto';

export interface AuditEntry {
  adminId: string | null;
  action: AuditActionValue;
  entityType: AuditEntityValue;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an audit entry. When a transaction client is supplied the write participates in
   * that transaction (and its failure aborts it). Otherwise failures are logged and swallowed
   * so auditing can never break the primary operation after it has already succeeded.
   */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      adminId: entry.adminId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata:
        entry.metadata === undefined
          ? Prisma.DbNull
          : (sanitizeAuditMetadata(entry.metadata) as Prisma.InputJsonValue),
      ipAddress: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
    };
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    try {
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log ${entry.action}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async list(query: ListAuditLogsQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
        include: { admin: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return Paginated.of(items, total, query.page, query.limit);
  }

  recent(limit: number) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        admin: { select: { id: true, name: true } },
      },
    });
  }
}
