import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("SESSION_SECRET environment variable must be set");
}

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  districtId?: number | null;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
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
    }
  }
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
    req.supabaseUser = user;
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
    req.supabaseUser = (await resp.json()) as { id: string; email: string };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Token verification failed" });
  }
}

export function requireRoles(...roles: string[]) {
  const normalised = roles.map(r => r.toLowerCase());
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !normalised.includes(req.user.role.toLowerCase())) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}
