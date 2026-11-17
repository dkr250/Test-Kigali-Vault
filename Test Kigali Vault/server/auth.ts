import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, nowIso } from './db.ts';

const SECRET_SEED =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`meridian-vault-session-${process.cwd()}`)
    .digest('hex');

export type UserRole = 'member' | 'staff' | 'super_admin';

export interface StaffPermissionSet {
  staff_code: string;
  title: string;
  can_manage_storage: boolean;
  can_manage_inventory: boolean;
  can_manage_orders: boolean;
  can_view_reports: boolean;
  can_assist_members: boolean;
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  role: UserRole;
  status: string;
  staff_permissions: StaffPermissionSet | null;
  storage_id: string | null;
  member_id: number | null;
  application_status: string | null;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

interface TokenPayload {
  uid: number;
  role: UserRole;
  exp: number;
}

export function signSessionToken(uid: number, role: UserRole): string {
  const payload: TokenPayload = {
    uid,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_SEED).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SECRET_SEED).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.uid !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

export function loadAuthUserById(userId: number): AuthUser | null {
  const userRow = db
    .prepare('SELECT id, email, full_name, phone, role, status FROM users WHERE id = ?')
    .get(userId) as
    | {
        id: number;
        email: string;
        full_name: string;
        phone: string;
        role: UserRole;
        status: string;
      }
    | undefined;

  if (!userRow) return null;

  let staffPermissions: StaffPermissionSet | null = null;
  if (userRow.role === 'staff') {
    const permRow = db
      .prepare(
        `SELECT staff_code, title, can_manage_storage, can_manage_inventory,
                can_manage_orders, can_view_reports, can_assist_members
         FROM staff_permissions WHERE user_id = ?`
      )
      .get(userRow.id) as
      | {
          staff_code: string;
          title: string;
          can_manage_storage: number;
          can_manage_inventory: number;
          can_manage_orders: number;
          can_view_reports: number;
          can_assist_members: number;
        }
      | undefined;
    if (permRow) {
      staffPermissions = {
        staff_code: permRow.staff_code,
        title: permRow.title,
        can_manage_storage: permRow.can_manage_storage === 1,
        can_manage_inventory: permRow.can_manage_inventory === 1,
        can_manage_orders: permRow.can_manage_orders === 1,
        can_view_reports: permRow.can_view_reports === 1,
        can_assist_members: permRow.can_assist_members === 1,
      };
    }
  }

  let storageId: string | null = null;
  let memberId: number | null = null;
  let applicationStatus: string | null = null;

  if (userRow.role === 'member') {
    const memberRow = db
      .prepare('SELECT id, storage_id, application_status FROM member_profiles WHERE user_id = ?')
      .get(userRow.id) as
      | { id: number; storage_id: string | null; application_status: string }
      | undefined;
    if (memberRow) {
      memberId = memberRow.id;
      storageId = memberRow.storage_id;
      applicationStatus = memberRow.application_status;
    }
  }

  return {
    id: userRow.id,
    email: userRow.email,
    full_name: userRow.full_name,
    phone: userRow.phone,
    role: userRow.role,
    status: userRow.status,
    staff_permissions: staffPermissions,
    storage_id: storageId,
    member_id: memberId,
    application_status: applicationStatus,
  };
}

export function extractTokenFromReq(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.method === 'GET' && req.path.endsWith('/orders/stream') && typeof req.query.token === 'string') {
    const qTok = req.query.token.trim();
    if (qTok) return qTok;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies.mv_session || null;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractTokenFromReq(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  const authUser = loadAuthUserById(payload.uid);
  if (!authUser) {
    res.status(401).json({ error: 'Account not found.' });
    return;
  }
  if (authUser.status === 'deactivated' || authUser.status === 'suspended') {
    res.status(403).json({ error: `Account is ${authUser.status}. Contact Super Admin.` });
    return;
  }
  req.authUser = authUser;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient role privileges.' });
      return;
    }
    if (req.authUser.role === 'member' && req.authUser.status !== 'active') {
      res.status(403).json({ error: 'Member account is not active.' });
      return;
    }
    next();
  };
}

export type StaffPermissionKey =
  | 'can_manage_storage'
  | 'can_manage_inventory'
  | 'can_manage_orders'
  | 'can_view_reports'
  | 'can_assist_members';

export function requireOperationsPermission(permKey: StaffPermissionKey) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (user.role === 'super_admin') {
      next();
      return;
    }
    if (user.role === 'staff' && user.status === 'active' && user.staff_permissions?.[permKey]) {
      next();
      return;
    }
    res.status(403).json({
      error: `Forbidden: permission "${permKey.replace('can_', '').replace('_', ' ')}" is required.`,
    });
  };
}

export function getActorLabel(user: AuthUser): string {
  if (user.role === 'super_admin') return 'Super Admin';
  if (user.role === 'staff') {
    return user.staff_permissions?.staff_code || user.full_name;
  }
  return user.storage_id ? `Member ${user.storage_id}` : user.full_name;
}

export function recordAuditLog(params: {
  actorUserId: number | null;
  actorLabel: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetRef: string;
  details: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (
      actor_user_id, actor_label, actor_role, action, target_type, target_ref, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.actorUserId,
    params.actorLabel,
    params.actorRole,
    params.action,
    params.targetType,
    params.targetRef,
    params.details,
    nowIso()
  );
}

export function notifyUser(params: {
  userId: number;
  category:
    | 'sale_completed'
    | 'stock_change'
    | 'product_registered'
    | 'product_archived'
    | 'storage_allocation'
    | 'rental_fee'
    | 'storage_request'
    | 'announcement';
  title: string;
  message: string;
}): void {
  db.prepare(
    `INSERT INTO notifications (user_id, category, title, message, is_read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(params.userId, params.category, params.title, params.message, nowIso());
}
