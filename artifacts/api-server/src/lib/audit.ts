import { supa } from "./supabase.js";
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
    await supa.from("audit_logs").insert({
      user_id: req.user?.userId ?? null,
      username: req.user?.username ?? null,
      action,
      module,
      description,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      ip_address: req.ip ?? null,
      user_agent: req.headers["user-agent"] ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch {
    // Non-blocking
  }
}
