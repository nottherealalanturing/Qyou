import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEvent {
  action: string;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  /** Non-secret context only. Never put passwords, tokens or hashes here. */
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes inside the caller's transaction when `tx` is given, so the audit record commits or
   * rolls back together with the change it describes. Without `tx` it is best-effort: a failure
   * to audit is logged (name only) but does not fail the request.
   */
  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const data = {
      action: event.action,
      actorUserId: event.actorUserId ?? null,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    };
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    try {
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write audit event ${event.action} (${error instanceof Error ? error.name : 'error'})`,
      );
    }
  }
}
