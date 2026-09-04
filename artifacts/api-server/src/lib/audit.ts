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
      // Legacy schemas store an integer here while newer schemas use UUID.
      // A Supabase identity is therefore recorded by verified email unless a
      // legacy numeric user id is available.
      user_id: req.user?.userId ?? null,
      username: req.supabaseUser?.email ?? req.user?.username ?? null,
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
