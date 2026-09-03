import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { supa } from "./supabase.js";

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET environment variable must be set in production");
  }
  // eslint-disable-next-line no-console
  console.warn("[auth] SESSION_SECRET not set — using insecure dev default. Set this in production.");
}
const JWT_SECRET = process.env.SESSION_SECRET ?? "changeme-secret-dev-only";

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  districtId?: number | null;
}

export interface SupabaseProfile {
  id: string;
  email: string;
  role: string;
  districtId?: number | null;
  isActive: boolean;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function generateUploadToken(key: string): string {
  return jwt.sign({ key }, JWT_SECRET, { expiresIn: "15m" });
}

export function verifyUploadToken(token: string): string {
  const payload = jwt.verify(token, JWT_SECRET) as { key?: string };
  if (!payload.key) throw new Error("Invalid upload token");
  return payload.key;
}

export function generateProxyUploadUrl(key: string, req: Request): string {
  const token = generateUploadToken(key);

  // Priority: x-forwarded-host (reverse proxy) → REPLIT_DOMAINS (deployment) → host header
  const fwdHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const fwdProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";

  let host: string;
  let proto: string;

  if (fwdHost && fwdHost !== "localhost") {
    host = fwdHost;
    proto = fwdProto;
  } else {
    const replitDomains = process.env.REPLIT_DOMAINS;
    if (replitDomains) {
      host = replitDomains.split(",")[0].trim();
      proto = "https";
    } else {
      host = req.get("host") ?? "localhost";
      proto = (req.protocol ?? "http");
    }
  }

  return `${proto}://${host}/api/upload-proxy?key=${encodeURIComponent(key)}&t=${token}`;
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      supabaseUser?: { id: string; email: string };
      supabaseProfile?: SupabaseProfile;
    }
  }
}

async function loadActiveSupabaseProfile(
  user: { id: string; email: string },
  res: Response,
): Promise<SupabaseProfile | null> {
  const { data, error } = await supa
    .from("profiles")
    .select("id,email,role,district_id,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: "Authorization profile lookup failed" });
    return null;
  }
  if (!data) {
    res.status(403).json({ error: "Account profile is unavailable" });
    return null;
  }
  if (data.is_active === false) {
    res.status(403).json({ error: "Account is inactive" });
    return null;
  }

  return {
    id: data.id,
    email: data.email ?? user.email,
    role: data.role ?? "FieldOfficer",
    districtId: data.district_id ?? null,
    isActive: true,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or invalid token" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Token expired or invalid" });
  }
}

export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Supabase not configured on server" });
    return;
  }

  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseKey,
      },
    });
    if (!resp.ok) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid Supabase token" });
      return;
    }
    const user = (await resp.json()) as { id: string; email: string };
    const profile = await loadActiveSupabaseProfile(user, res);
    if (!profile) return;
    req.supabaseUser = user;
    req.supabaseProfile = profile;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Token verification failed" });
  }
}

export async function requireAnyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Missing token" });
    return;
  }
  const token = authHeader.slice(7);
  // Try mobile JWT first
  try {
    req.user = verifyToken(token);
    next();
    return;
  } catch {
    // Not a mobile JWT — try Supabase token
  }
  // Try Supabase session token
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Auth not configured" });
    return;
  }
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
    });
    if (!resp.ok) { res.status(401).json({ error: "Unauthorized" }); return; }
    const user = (await resp.json()) as { id: string; email: string };
    const profile = await loadActiveSupabaseProfile(user, res);
    if (!profile) return;
    req.supabaseUser = user;
    req.supabaseProfile = profile;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Token verification failed" });
  }
}

export function requireRoles(...roles: string[]) {
  const normalise = (role: string) => role.toLowerCase().replace(/[\s_-]/g, "");
  const normalised = roles.map(normalise);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !normalised.includes(normalise(req.user.role))) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireRoleIfJwt(...roles: string[]) {
  const normalise = (role: string) => role.toLowerCase().replace(/[\s_-]/g, "");
  const normalised = roles.map(normalise);
  return (req: Request, res: Response, next: NextFunction): void => {
    const effectiveRole = req.user?.role ?? req.supabaseProfile?.role;
    if (!effectiveRole || !normalised.includes(normalise(effectiveRole))) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}
