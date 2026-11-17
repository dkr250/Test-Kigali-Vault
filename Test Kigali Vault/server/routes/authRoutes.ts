import { Router } from 'express';
import {
  type AuthenticatedRequest,
  loadAuthUserById,
  recordAuditLog,
  requireAuth,
  signSessionToken,
} from '../auth.ts';
import { db, hashPassword, nowIso, runInTransaction, verifyPassword } from '../db.ts';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const userRow = db
    .prepare('SELECT id, password_hash, status, role FROM users WHERE LOWER(email) = ?')
    .get(normalizedEmail) as
    | { id: number; password_hash: string; status: string; role: string }
    | undefined;

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (userRow.status === 'deactivated' || userRow.status === 'suspended') {
    res.status(403).json({
      error: `Your account is currently ${userRow.status}. Please contact the Super Admin.`,
    });
    return;
  }

  const authUser = loadAuthUserById(userRow.id);
  if (!authUser) {
    res.status(500).json({ error: 'Unable to load account profile.' });
    return;
  }

  const token = signSessionToken(authUser.id, authUser.role);
  res.cookie('mv_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/',
  });

  res.json({ token, user: authUser });
});

authRouter.post('/register-member', (req, res) => {
  const {
    full_name,
    business_name,
    email,
    phone,
    password,
    requested_space_sqm,
    notes,
  } = req.body as {
    full_name?: string;
    business_name?: string;
    email?: string;
    phone?: string;
    password?: string;
    requested_space_sqm?: number;
    notes?: string;
  };

  if (!full_name?.trim() || !email?.trim() || !phone?.trim() || !password) {
    res.status(400).json({ error: 'All required registration fields must be filled.' });
    return;
  }
  const entityName = business_name?.trim() || full_name.trim();
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }
  const space = Number(requested_space_sqm);
  if (!Number.isFinite(space) || space < 5 || space > 5000) {
    res.status(400).json({ error: 'Requested storage space must be between 5 and 5,000 sqm.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db
    .prepare('SELECT id FROM users WHERE LOWER(email) = ?')
    .get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const userId = runInTransaction(() => {
    const ts = nowIso();
    const uRes = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'member', 'pending_approval', ?, ?)`
      )
      .run(
        normalizedEmail,
        hashPassword(password),
        full_name.trim(),
        phone.trim(),
        ts,
        ts
      );
    const uid = Number(uRes.lastInsertRowid);

    db.prepare(
      `INSERT INTO member_profiles (
        user_id, business_name, storage_id, application_status,
        requested_space_sqm, allocated_space_sqm, occupied_space_sqm,
        monthly_rental_fee, notes, created_at
      ) VALUES (?, ?, NULL, 'pending', ?, 0, 0, 0, ?, ?)`
    ).run(uid, entityName, space, (notes || '').trim(), ts);

    recordAuditLog({
      actorUserId: uid,
      actorLabel: entityName,
      actorRole: 'member_applicant',
      action: 'submit_storage_application',
      targetType: 'member_application',
      targetRef: normalizedEmail,
      details: `${entityName} submitted a storage application for ${space} sqm.`,
    });

    return uid;
  });

  const authUser = loadAuthUserById(userId);
  if (!authUser) {
    res.status(500).json({ error: 'Registration failed.' });
    return;
  }

  const token = signSessionToken(authUser.id, authUser.role);
  res.cookie('mv_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/',
  });

  res.status(201).json({ token, user: authUser });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('mv_session', { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});
