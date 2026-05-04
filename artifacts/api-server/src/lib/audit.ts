import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import type { Request } from "express";

export async function logAudit(
  req: Request,
  action: string,
  module: string,
  description: string,
  entityType?: string,
  entityId?: number,
  metadata?: unknown
) {
  try {
    await db.insert(auditLogsTable).values({
      userId: req.user?.userId,
      username: req.user?.username,
      action,
      module,
      description,
      entityType,
      entityId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });
  } catch {
    // Non-blocking audit log
  }
}
