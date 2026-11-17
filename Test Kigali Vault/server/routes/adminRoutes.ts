import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import {
  type AuthenticatedRequest,
  notifyUser,
  recordAuditLog,
  requireAuth,
  requireRole,
} from '../auth.ts';
import { db, getUploadsDir, hashPassword, nowIso, runInTransaction } from '../db.ts';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('super_admin'));

adminRouter.get('/overview', (_req, res) => {
  const revenueRow = db
    .prepare(
      'SELECT COUNT(*) AS completed_sales_count, COALESCE(SUM(total_amount), 0) AS total_revenue, COALESCE(SUM(quantity_sold), 0) AS units_sold FROM sales_transactions'
    )
    .get() as { completed_sales_count: number; total_revenue: number; units_sold: number };

  const orderCounts = db
    .prepare(
      `SELECT COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END), 0) AS active_orders,
              COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed_orders
       FROM orders`
    )
    .get() as { total_orders: number; active_orders: number; completed_orders: number };

  const storageRow = db
    .prepare(
      `SELECT COUNT(*) AS approved_members,
              COALESCE(SUM(allocated_space_sqm), 0) AS total_allocated_sqm,
              COALESCE(SUM(occupied_space_sqm), 0) AS total_occupied_sqm,
              COALESCE(SUM(monthly_rental_fee), 0) AS monthly_rental_revenue
       FROM member_profiles WHERE application_status = 'approved'`
    )
    .get() as {
    approved_members: number;
    total_allocated_sqm: number;
    total_occupied_sqm: number;
    monthly_rental_revenue: number;
  };

  const pendingApps = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM member_profiles WHERE application_status = 'pending'")
      .get() as { cnt: number }
  ).cnt;

  const pendingStorageReqs = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM additional_storage_requests WHERE status = 'Pending'")
      .get() as { cnt: number }
  ).cnt;

  const staffRow = db
    .prepare(
      `SELECT COUNT(*) AS total_staff,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_staff
       FROM users WHERE role = 'staff'`
    )
    .get() as { total_staff: number; active_staff: number };

  const listingsCount = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM product_listings WHERE status != 'Archived'")
      .get() as { cnt: number }
  ).cnt;

  const recentAudit = db
    .prepare(
      `SELECT id, actor_label, actor_role, action, target_type, target_ref, details, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT 12`
    )
    .all();

  res.json({
    revenue: revenueRow,
    orders: orderCounts,
    storage: storageRow,
    pending_applications: pendingApps,
    pending_storage_requests: pendingStorageReqs,
    staff: staffRow,
    active_listings: listingsCount,
    recent_audit: recentAudit,
  });
});

// ========================
// SUPER ADMIN ACCOUNT & CREDENTIALS
// ========================

function generateSecureSuperAdminPassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_+=';
  const all = upper + lower + digits + symbols;

  const chars: string[] = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];
  while (chars.length < length) {
    chars.push(all[crypto.randomInt(0, all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

adminRouter.get('/account', (req: AuthenticatedRequest, res) => {
  const admin = req.authUser!;
  const row = db
    .prepare("SELECT id, email, full_name, phone, status, created_at FROM users WHERE id = ? AND role = 'super_admin'")
    .get(admin.id);
  if (!row) {
    res.status(404).json({ error: 'Super Admin account not found.' });
    return;
  }
  res.json({ account: row });
});

adminRouter.patch('/account', (req: AuthenticatedRequest, res) => {
  const admin = req.authUser!;
  const { full_name, email, phone } = req.body as {
    full_name?: string;
    email?: string;
    phone?: string;
  };

  if (!full_name?.trim() || !email?.trim() || !phone?.trim()) {
    res.status(400).json({ error: 'Full name, email, and phone are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const duplicate = db
    .prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?')
    .get(normalizedEmail, admin.id);
  if (duplicate) {
    res.status(409).json({ error: 'Another account already uses this email address.' });
    return;
  }

  const ts = nowIso();
  runInTransaction(() => {
    db.prepare(
      "UPDATE users SET full_name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ? AND role = 'super_admin'"
    ).run(full_name.trim(), normalizedEmail, phone.trim(), ts, admin.id);

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'update_super_admin_profile',
      targetType: 'super_admin',
      targetRef: 'Super Admin',
      details: `Super Admin updated account profile (${full_name.trim()} · ${normalizedEmail}).`,
    });
  });

  const updated = db
    .prepare("SELECT id, email, full_name, phone, status, created_at FROM users WHERE id = ? AND role = 'super_admin'")
    .get(admin.id);
  res.json({ account: updated });
});

adminRouter.post('/account/reset-password', (req: AuthenticatedRequest, res) => {
  const admin = req.authUser!;
  const generatedPassword = generateSecureSuperAdminPassword(16);
  const ts = nowIso();

  runInTransaction(() => {
    db.prepare(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND role = 'super_admin'"
    ).run(hashPassword(generatedPassword), ts, admin.id);

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'reset_super_admin_password',
      targetType: 'super_admin',
      targetRef: 'Super Admin',
      details: 'Super Admin generated and rotated system-issued Super Admin credentials.',
    });
  });

  res.json({ generated_password: generatedPassword });
});

// ========================
// STAFF ACCOUNT & PERMISSION MANAGEMENT
// ========================

adminRouter.get('/staff', (_req, res) => {
  const staff = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.created_at,
              sp.staff_code, sp.title, sp.can_manage_storage, sp.can_manage_inventory,
              sp.can_manage_orders, sp.can_view_reports, sp.can_assist_members, sp.updated_at,
              (SELECT COUNT(*) FROM audit_logs a WHERE a.actor_user_id = u.id) AS activity_count
       FROM users u
       JOIN staff_permissions sp ON sp.user_id = u.id
       WHERE u.role = 'staff'
       ORDER BY sp.staff_code ASC`
    )
    .all() as Array<{
    id: number;
    email: string;
    full_name: string;
    phone: string;
    status: string;
    created_at: string;
    staff_code: string;
    title: string;
    can_manage_storage: number;
    can_manage_inventory: number;
    can_manage_orders: number;
    can_view_reports: number;
    can_assist_members: number;
    updated_at: string;
    activity_count: number;
  }>;

  res.json({
    staff: staff.map((s) => ({
      ...s,
      can_manage_storage: s.can_manage_storage === 1,
      can_manage_inventory: s.can_manage_inventory === 1,
      can_manage_orders: s.can_manage_orders === 1,
      can_view_reports: s.can_view_reports === 1,
      can_assist_members: s.can_assist_members === 1,
    })),
  });
});

adminRouter.post('/staff', (req: AuthenticatedRequest, res) => {
  const {
    email,
    password,
    full_name,
    phone,
    title,
    can_manage_storage,
    can_manage_inventory,
    can_manage_orders,
    can_view_reports,
    can_assist_members,
  } = req.body as {
    email?: string;
    password?: string;
    full_name?: string;
    phone?: string;
    title?: string;
    can_manage_storage?: boolean;
    can_manage_inventory?: boolean;
    can_manage_orders?: boolean;
    can_view_reports?: boolean;
    can_assist_members?: boolean;
  };

  if (!email?.trim() || !password || !full_name?.trim() || !phone?.trim() || !title?.trim()) {
    res.status(400).json({ error: 'All staff account fields are required.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail);
  if (exists) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const admin = req.authUser!;
  const created = runInTransaction(() => {
    const countRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'staff'")
      .get() as { cnt: number };
    const nextNum = countRow.cnt + 1;
    const staffCode = `Staff ${String(nextNum).padStart(2, '0')}`;
    const ts = nowIso();

    const uRes = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'staff', 'active', ?, ?)`
      )
      .run(normalizedEmail, hashPassword(password), full_name.trim(), phone.trim(), ts, ts);
    const uid = Number(uRes.lastInsertRowid);

    db.prepare(
      `INSERT INTO staff_permissions (
        user_id, staff_code, title, can_manage_storage, can_manage_inventory,
        can_manage_orders, can_view_reports, can_assist_members, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid,
      staffCode,
      title.trim(),
      can_manage_storage ? 1 : 0,
      can_manage_inventory ? 1 : 0,
      can_manage_orders ? 1 : 0,
      can_view_reports ? 1 : 0,
      can_assist_members ? 1 : 0,
      admin.id,
      ts
    );

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'create_staff_account',
      targetType: 'staff',
      targetRef: staffCode,
      details: `Super Admin created staff account ${staffCode} (${full_name.trim()} · ${title.trim()}).`,
    });

    return { id: uid, staff_code: staffCode };
  });

  res.status(201).json(created);
});

adminRouter.patch('/staff/:userId', (req: AuthenticatedRequest, res) => {
  const userId = Number(req.params.userId);
  const {
    full_name,
    email,
    phone,
    password,
    status,
    title,
    can_manage_storage,
    can_manage_inventory,
    can_manage_orders,
    can_view_reports,
    can_assist_members,
  } = req.body as {
    full_name?: string;
    email?: string;
    phone?: string;
    password?: string;
    status?: 'active' | 'deactivated' | 'suspended';
    title?: string;
    can_manage_storage?: boolean;
    can_manage_inventory?: boolean;
    can_manage_orders?: boolean;
    can_view_reports?: boolean;
    can_assist_members?: boolean;
  };

  if (password !== undefined && password !== '' && password.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }

  const admin = req.authUser!;

  try {
    runInTransaction(() => {
      const target = db
        .prepare(
          `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.status, sp.staff_code, sp.title
           FROM users u
           JOIN staff_permissions sp ON sp.user_id = u.id
           WHERE u.id = ? AND u.role = 'staff'`
        )
        .get(userId) as
        | {
            id: number;
            email: string;
            full_name: string;
            phone: string;
            role: string;
            status: string;
            staff_code: string;
            title: string;
          }
        | undefined;

      if (!target) {
        throw new Error('Staff account not found.');
      }

      const nextEmail = email !== undefined ? email.trim().toLowerCase() : target.email;
      if (!nextEmail) {
        throw new Error('Email address cannot be empty.');
      }
      if (nextEmail !== target.email.toLowerCase()) {
        const duplicate = db
          .prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?')
          .get(nextEmail, userId);
        if (duplicate) {
          throw new Error('An account with this email already exists.');
        }
      }

      const nextName = full_name !== undefined ? full_name.trim() : target.full_name;
      if (!nextName) {
        throw new Error('Full name cannot be empty.');
      }
      const nextPhone = phone !== undefined ? phone.trim() : target.phone;
      const nextStatus =
        status && ['active', 'deactivated', 'suspended'].includes(status) ? status : target.status;

      const ts = nowIso();
      if (password && password.length >= 6) {
        db.prepare(
          'UPDATE users SET full_name = ?, email = ?, phone = ?, status = ?, password_hash = ?, updated_at = ? WHERE id = ?'
        ).run(nextName, nextEmail, nextPhone, nextStatus, hashPassword(password), ts, userId);
      } else {
        db.prepare(
          'UPDATE users SET full_name = ?, email = ?, phone = ?, status = ?, updated_at = ? WHERE id = ?'
        ).run(nextName, nextEmail, nextPhone, nextStatus, ts, userId);
      }

      db.prepare(
        `UPDATE staff_permissions
         SET title = COALESCE(?, title),
             can_manage_storage = COALESCE(?, can_manage_storage),
             can_manage_inventory = COALESCE(?, can_manage_inventory),
             can_manage_orders = COALESCE(?, can_manage_orders),
             can_view_reports = COALESCE(?, can_view_reports),
             can_assist_members = COALESCE(?, can_assist_members),
             updated_by = ?,
             updated_at = ?
         WHERE user_id = ?`
      ).run(
        title?.trim() || null,
        can_manage_storage === undefined ? null : can_manage_storage ? 1 : 0,
        can_manage_inventory === undefined ? null : can_manage_inventory ? 1 : 0,
        can_manage_orders === undefined ? null : can_manage_orders ? 1 : 0,
        can_view_reports === undefined ? null : can_view_reports ? 1 : 0,
        can_assist_members === undefined ? null : can_assist_members ? 1 : 0,
        admin.id,
        ts,
        userId
      );

      recordAuditLog({
        actorUserId: admin.id,
        actorLabel: 'Super Admin',
        actorRole: 'super_admin',
        action: 'update_staff_account',
        targetType: 'staff',
        targetRef: target.staff_code,
        details: `Super Admin updated ${target.staff_code} (${nextName} · status: ${nextStatus}${password ? ' · password updated' : ''}).`,
      });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update staff.' });
  }
});

// ========================
// ALL MEMBERS & STORAGE MONITORING
// ========================

adminRouter.get('/members', (_req, res) => {
  const members = db
    .prepare(
      `SELECT m.id, m.user_id, m.business_name, m.storage_id, m.application_status,
              m.requested_space_sqm, m.allocated_space_sqm, m.occupied_space_sqm,
              m.monthly_rental_fee, m.notes, m.created_at,
              u.full_name, u.email, u.phone, u.status AS user_status,
              COALESCE((SELECT SUM(s.total_amount) FROM sales_transactions s WHERE s.member_id = m.id), 0) AS total_sales_revenue,
              (SELECT COUNT(*) FROM product_listings p WHERE p.member_id = m.id AND p.status != 'Archived') AS active_listings
       FROM member_profiles m
       JOIN users u ON u.id = m.user_id
       ORDER BY m.created_at DESC`
    )
    .all();

  res.json({ members });
});

adminRouter.post('/members/:memberId/allocation', (req: AuthenticatedRequest, res) => {
  const memberId = Number(req.params.memberId);
  const { allocated_space_sqm, monthly_rental_fee, cancel_membership, note } = req.body as {
    allocated_space_sqm?: number;
    monthly_rental_fee?: number;
    cancel_membership?: boolean;
    note?: string;
  };
  const admin = req.authUser!;

  try {
    runInTransaction(() => {
      const m = db
        .prepare(
          `SELECT id, user_id, business_name, storage_id, application_status,
                  allocated_space_sqm, monthly_rental_fee
           FROM member_profiles WHERE id = ?`
        )
        .get(memberId) as
        | {
            id: number;
            user_id: number;
            business_name: string;
            storage_id: string | null;
            application_status: string;
            allocated_space_sqm: number;
            monthly_rental_fee: number;
          }
        | undefined;

      if (!m || !m.storage_id) {
        throw new Error('Approved member with Storage ID not found.');
      }

      const ts = nowIso();

      if (cancel_membership) {
        // Storage ID is preserved in member_profiles and NEVER reused!
        db.prepare("UPDATE member_profiles SET application_status = 'cancelled' WHERE id = ?").run(m.id);
        db.prepare("UPDATE users SET status = 'deactivated', updated_at = ? WHERE id = ?").run(ts, m.user_id);

        db.prepare(
          `INSERT INTO storage_allocation_history (
            member_id, storage_id, change_type, previous_space_sqm, new_space_sqm,
            previous_fee, new_fee, note, performed_by, created_at
          ) VALUES (?, ?, 'membership_cancelled', ?, 0, ?, 0, ?, ?, ?)`
        ).run(
          m.id,
          m.storage_id,
          m.allocated_space_sqm,
          m.monthly_rental_fee,
          (note || `Membership cancelled; ${m.storage_id} permanently retired.`).trim(),
          admin.id,
          ts
        );

        recordAuditLog({
          actorUserId: admin.id,
          actorLabel: 'Super Admin',
          actorRole: 'super_admin',
          action: 'cancel_membership',
          targetType: 'member_profile',
          targetRef: m.storage_id,
          details: `Super Admin cancelled membership for ${m.storage_id} (${m.business_name}); ID permanently retired.`,
        });
        return;
      }

      const nextSpace =
        allocated_space_sqm !== undefined ? Number(allocated_space_sqm) : m.allocated_space_sqm;
      const nextFee =
        monthly_rental_fee !== undefined ? Number(monthly_rental_fee) : m.monthly_rental_fee;

      if (!Number.isFinite(nextSpace) || nextSpace <= 0 || !Number.isFinite(nextFee) || nextFee < 0) {
        throw new Error('Invalid space or rental fee value.');
      }

      db.prepare(
        'UPDATE member_profiles SET allocated_space_sqm = ?, monthly_rental_fee = ? WHERE id = ?'
      ).run(nextSpace, nextFee, m.id);

      const changeType = nextSpace !== m.allocated_space_sqm ? 'expansion_approved' : 'fee_adjusted';
      db.prepare(
        `INSERT INTO storage_allocation_history (
          member_id, storage_id, change_type, previous_space_sqm, new_space_sqm,
          previous_fee, new_fee, note, performed_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        m.id,
        m.storage_id,
        changeType,
        m.allocated_space_sqm,
        nextSpace,
        m.monthly_rental_fee,
        nextFee,
        (note || 'Direct allocation/fee adjustment by Super Admin.').trim(),
        admin.id,
        ts
      );

      notifyUser({
        userId: m.user_id,
        category: nextFee !== m.monthly_rental_fee ? 'rental_fee' : 'storage_allocation',
        title: `Storage Allocation Updated · ${m.storage_id}`,
        message: `Super Admin updated ${m.storage_id}: ${nextSpace} sqm allocated, monthly rental fee ${nextFee.toLocaleString()} RWF.`,
      });

      recordAuditLog({
        actorUserId: admin.id,
        actorLabel: 'Super Admin',
        actorRole: 'super_admin',
        action: 'adjust_member_allocation',
        targetType: 'storage_allocation',
        targetRef: m.storage_id,
        details: `Super Admin adjusted ${m.storage_id} allocation to ${nextSpace} sqm (${nextFee.toLocaleString()} RWF/mo).`,
      });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Allocation update failed.' });
  }
});

// ========================
// SALES, REPORTS, AUDIT LOGS & SETTINGS
// ========================

adminRouter.get('/sales', (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let dateClause = '';
  const params: string[] = [];
  if (from) {
    dateClause += ' AND DATE(s.created_at) >= DATE(?)';
    params.push(from);
  }
  if (to) {
    dateClause += ' AND DATE(s.created_at) <= DATE(?)';
    params.push(to);
  }

  const sales = db
    .prepare(
      `SELECT s.id, s.order_reference, s.storage_id, s.product_name,
              s.quantity_sold, s.unit_price, s.total_amount, s.created_at,
              COALESCE(sp.staff_code, u.full_name, 'Super Admin') AS confirmed_by_label
       FROM sales_transactions s
       LEFT JOIN users u ON u.id = s.confirmed_by
       LEFT JOIN staff_permissions sp ON sp.user_id = u.id
       WHERE 1=1 ${dateClause}
       ORDER BY s.created_at DESC`
    )
    .all(...params);

  res.json({ sales });
});

adminRouter.get('/reports', (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let dateClause = '';
  const params: string[] = [];
  if (from) {
    dateClause += ' AND DATE(s.created_at) >= DATE(?)';
    params.push(from);
  }
  if (to) {
    dateClause += ' AND DATE(s.created_at) <= DATE(?)';
    params.push(to);
  }

  const byCategory = db
    .prepare(
      `SELECT p.category,
              SUM(s.quantity_sold) AS units_sold,
              SUM(s.total_amount) AS revenue
       FROM sales_transactions s
       JOIN product_listings p ON p.id = s.listing_id
       WHERE 1=1 ${dateClause}
       GROUP BY p.category
       ORDER BY revenue DESC`
    )
    .all(...params);

  const byMember = db
    .prepare(
      `SELECT m.storage_id, m.business_name,
              m.allocated_space_sqm, m.occupied_space_sqm,
              COALESCE(SUM(s.quantity_sold), 0) AS units_sold,
              COALESCE(SUM(s.total_amount), 0) AS revenue
       FROM member_profiles m
       LEFT JOIN sales_transactions s ON s.member_id = m.id ${dateClause.replace('WHERE 1=1', '')}
       WHERE m.application_status = 'approved'
       GROUP BY m.id
       ORDER BY revenue DESC`
    )
    .all(...params);

  const staffActivity = db
    .prepare(
      `SELECT sp.staff_code, u.full_name, sp.title, u.status,
              COUNT(a.id) AS actions_logged
       FROM users u
       JOIN staff_permissions sp ON sp.user_id = u.id
       LEFT JOIN audit_logs a ON a.actor_user_id = u.id
       WHERE u.role = 'staff'
       GROUP BY u.id
       ORDER BY actions_logged DESC`
    )
    .all();

  res.json({ by_category: byCategory, by_member: byMember, staff_activity: staffActivity });
});

adminRouter.get('/audit-logs', (req, res) => {
  const roleFilter = String(req.query.role || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let clause = 'WHERE 1=1';
  const params: string[] = [];

  if (roleFilter && roleFilter !== 'all') {
    clause += ' AND actor_role = ?';
    params.push(roleFilter);
  }
  if (from) {
    clause += ' AND DATE(created_at) >= DATE(?)';
    params.push(from);
  }
  if (to) {
    clause += ' AND DATE(created_at) <= DATE(?)';
    params.push(to);
  }

  const rows = db
    .prepare(
      `SELECT id, actor_label, actor_role, action, target_type, target_ref, details, created_at
       FROM audit_logs ${clause}
       ORDER BY created_at DESC, id DESC LIMIT 300`
    )
    .all(...params) as Array<{
    id: number;
    actor_label: string;
    actor_role: string;
    action: string;
    target_type: string;
    target_ref: string;
    details: string;
    created_at: string;
  }>;

  const filtered = search
    ? rows.filter((r) =>
        `${r.actor_label} ${r.action} ${r.target_ref} ${r.details}`.toLowerCase().includes(search)
      )
    : rows;

  res.json({ logs: filtered });
});

// Explicitly protect audit logs against modification or deletion
adminRouter.all('/audit-logs/*', (_req, res) => {
  res.status(403).json({ error: 'Audit logs are immutable and cannot be altered or deleted.' });
});

adminRouter.get('/settings', (_req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all() as Array<{
    key: string;
    value: string;
    updated_at: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({ settings: map });
});

adminRouter.patch('/settings', (req: AuthenticatedRequest, res) => {
  const updates = req.body as Record<string, string | number | boolean>;
  const allowedKeys = [
    'warehouse_name',
    'currency_code',
    'base_rate_per_sqm',
    'delivery_fee',
    'free_delivery_threshold',
    'warehouse_address',
    'support_phone',
    'allow_guest_checkout',
    'require_staff_order_confirmation',
  ];

  const admin = req.authUser!;
  const ts = nowIso();

  runInTransaction(() => {
    const upsert = db.prepare(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );

    const changed: string[] = [];
    for (const k of allowedKeys) {
      if (updates[k] !== undefined) {
        upsert.run(k, String(updates[k]), ts);
        changed.push(k);
      }
    }

    if (changed.length > 0) {
      recordAuditLog({
        actorUserId: admin.id,
        actorLabel: 'Super Admin',
        actorRole: 'super_admin',
        action: 'update_system_settings',
        targetType: 'system_settings',
        targetRef: changed.join(', '),
        details: `Super Admin updated system settings (${changed.join(', ')}).`,
      });
    }
  });

  res.json({ ok: true });
});

adminRouter.post('/announcements', (req: AuthenticatedRequest, res) => {
  const { title, message, target_storage_id } = req.body as {
    title?: string;
    message?: string;
    target_storage_id?: string;
  };
  if (!title?.trim() || !message?.trim()) {
    res.status(400).json({ error: 'Announcement title and message are required.' });
    return;
  }

  const admin = req.authUser!;
  runInTransaction(() => {
    let recipients: Array<{ user_id: number }> = [];
    if (target_storage_id && target_storage_id !== 'ALL') {
      recipients = db
        .prepare("SELECT user_id FROM member_profiles WHERE storage_id = ? AND application_status = 'approved'")
        .all(target_storage_id) as Array<{ user_id: number }>;
    } else {
      recipients = db
        .prepare("SELECT user_id FROM member_profiles WHERE application_status = 'approved'")
        .all() as Array<{ user_id: number }>;
    }

    for (const r of recipients) {
      notifyUser({
        userId: r.user_id,
        category: 'announcement',
        title: title.trim(),
        message: message.trim(),
      });
    }

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'send_announcement',
      targetType: 'notification',
      targetRef: target_storage_id || 'ALL_MEMBERS',
      details: `Super Admin broadcast announcement "${title.trim()}" to ${recipients.length} member(s).`,
    });
  });

  res.status(201).json({ ok: true });
});

// ========================
// MARKETPLACE SLIDESHOW / BANNER MANAGER
// ========================

const DEFAULT_SLIDE_LOCATION = 'Plot 42, Kigali Special Economic Zone, Masoro';
const DEFAULT_SLIDE_DISPATCH =
  'Same-day warehouse collection or scheduled Kigali dispatch · Free delivery above 250,000 RWF';

adminRouter.post('/upload-media', (req, res) => {
  const { data_url, filename } = req.body as { data_url?: string; filename?: string };
  if (!data_url) {
    res.status(400).json({ error: 'Media payload is required.' });
    return;
  }

  const imgMatch = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(data_url);
  const vidMatch = /^data:video\/(mp4|webm|quicktime);base64,(.+)$/.exec(data_url);

  if (!imgMatch && !vidMatch) {
    res.status(400).json({
      error: 'Supported media formats: JPEG, PNG, WebP images or MP4, WebM, MOV videos.',
    });
    return;
  }

  const isVideo = Boolean(vidMatch);
  const rawExt = isVideo ? vidMatch![1] : imgMatch![1];
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt === 'quicktime' ? 'mov' : rawExt;
  const base64Body = isVideo ? vidMatch![2] : imgMatch![2];

  const buf = Buffer.from(base64Body, 'base64');
  if (buf.length > 25 * 1024 * 1024) {
    res.status(400).json({ error: 'Media file must be under 25 MB.' });
    return;
  }

  const safeBase = (filename || 'slide')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 24);
  const outName = `slide_${safeBase}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const outPath = path.join(getUploadsDir(), outName);
  fs.writeFileSync(outPath, buf);

  res.status(201).json({
    url: `/uploads/${outName}`,
    media_type: isVideo ? 'video' : 'image',
  });
});

adminRouter.get('/slides', (_req, res) => {
  const slides = db
    .prepare(
      `SELECT id, media_url, media_type, headline, location_text, dispatch_text,
              sort_order, is_active, created_at
       FROM hero_slides
       ORDER BY sort_order ASC, id ASC`
    )
    .all() as Array<{
    id: number;
    media_url: string;
    media_type: 'image' | 'video';
    headline: string;
    location_text: string;
    dispatch_text: string;
    sort_order: number;
    is_active: number;
    created_at: string;
  }>;

  const settingsRows = db
    .prepare("SELECT key, value FROM system_settings WHERE key IN ('hero_autoplay', 'hero_slide_interval_ms')")
    .all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of settingsRows) map[r.key] = r.value;

  res.json({
    slides: slides.map((s) => ({ ...s, is_active: s.is_active === 1 })),
    autoplay: map.hero_autoplay !== 'false',
    interval_ms: Number(map.hero_slide_interval_ms || 5500),
  });
});

adminRouter.post('/slides', (req: AuthenticatedRequest, res) => {
  const {
    media_url,
    media_type,
    headline,
    location_text,
    dispatch_text,
    is_active,
  } = req.body as {
    media_url?: string;
    media_type?: 'image' | 'video';
    headline?: string;
    location_text?: string;
    dispatch_text?: string;
    is_active?: boolean;
  };

  if (!media_url?.trim()) {
    res.status(400).json({ error: 'Slide picture or video URL is required.' });
    return;
  }

  const type = media_type === 'video' ? 'video' : 'image';
  const loc = location_text?.trim() || DEFAULT_SLIDE_LOCATION;
  const disp = dispatch_text?.trim() || DEFAULT_SLIDE_DISPATCH;
  const head = (headline || '').trim();
  const activeFlag = is_active === false ? 0 : 1;
  const admin = req.authUser!;

  const created = runInTransaction(() => {
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_ord FROM hero_slides')
      .get() as { max_ord: number };
    const ts = nowIso();
    const result = db
      .prepare(
        `INSERT INTO hero_slides (
          media_url, media_type, headline, location_text, dispatch_text,
          sort_order, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(media_url.trim(), type, head, loc, disp, maxRow.max_ord + 1, activeFlag, ts);

    const newId = Number(result.lastInsertRowid);
    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'create_hero_slide',
      targetType: 'hero_slide',
      targetRef: `Slide #${newId}`,
      details: `Super Admin added ${type} hero slide${head ? ` ("${head}")` : ''} to Marketplace Slideshow.`,
    });

    return {
      id: newId,
      media_url: media_url.trim(),
      media_type: type,
      headline: head,
      location_text: loc,
      dispatch_text: disp,
      sort_order: maxRow.max_ord + 1,
      is_active: activeFlag === 1,
      created_at: ts,
    };
  });

  res.status(201).json({ slide: created });
});

adminRouter.patch('/slides/:id', (req: AuthenticatedRequest, res) => {
  const slideId = Number(req.params.id);
  const {
    media_url,
    media_type,
    headline,
    location_text,
    dispatch_text,
    is_active,
  } = req.body as {
    media_url?: string;
    media_type?: 'image' | 'video';
    headline?: string;
    location_text?: string;
    dispatch_text?: string;
    is_active?: boolean;
  };

  const admin = req.authUser!;

  try {
    runInTransaction(() => {
      const existing = db
        .prepare('SELECT id, media_url, media_type, headline, location_text, dispatch_text, is_active FROM hero_slides WHERE id = ?')
        .get(slideId) as
        | {
            id: number;
            media_url: string;
            media_type: 'image' | 'video';
            headline: string;
            location_text: string;
            dispatch_text: string;
            is_active: number;
          }
        | undefined;

      if (!existing) {
        throw new Error('Slide not found.');
      }

      const nextUrl = media_url?.trim() || existing.media_url;
      const nextType = media_type === 'video' || media_type === 'image' ? media_type : existing.media_type;
      const nextHeadline = headline !== undefined ? headline.trim() : existing.headline;
      const nextLocation = location_text !== undefined ? (location_text.trim() || DEFAULT_SLIDE_LOCATION) : existing.location_text;
      const nextDispatch = dispatch_text !== undefined ? (dispatch_text.trim() || DEFAULT_SLIDE_DISPATCH) : existing.dispatch_text;
      const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;

      db.prepare(
        `UPDATE hero_slides
         SET media_url = ?, media_type = ?, headline = ?, location_text = ?,
             dispatch_text = ?, is_active = ?
         WHERE id = ?`
      ).run(nextUrl, nextType, nextHeadline, nextLocation, nextDispatch, nextActive, slideId);

      recordAuditLog({
        actorUserId: admin.id,
        actorLabel: 'Super Admin',
        actorRole: 'super_admin',
        action: 'update_hero_slide',
        targetType: 'hero_slide',
        targetRef: `Slide #${slideId}`,
        details: `Super Admin updated Marketplace hero slide #${slideId}.`,
      });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update slide.' });
  }
});

adminRouter.post('/slides/reorder', (req: AuthenticatedRequest, res) => {
  const { ordered_ids } = req.body as { ordered_ids?: number[] };
  if (!Array.isArray(ordered_ids) || ordered_ids.length === 0) {
    res.status(400).json({ error: 'ordered_ids array is required.' });
    return;
  }

  const admin = req.authUser!;
  runInTransaction(() => {
    const stmt = db.prepare('UPDATE hero_slides SET sort_order = ? WHERE id = ?');
    ordered_ids.forEach((id, idx) => {
      stmt.run(idx + 1, Number(id));
    });

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'reorder_hero_slides',
      targetType: 'hero_slide',
      targetRef: 'Marketplace Slideshow',
      details: `Super Admin reordered Marketplace hero slideshow (${ordered_ids.length} slides).`,
    });
  });

  res.json({ ok: true });
});

adminRouter.delete('/slides/:id', (req: AuthenticatedRequest, res) => {
  const slideId = Number(req.params.id);
  const admin = req.authUser!;

  runInTransaction(() => {
    const existing = db.prepare('SELECT id FROM hero_slides WHERE id = ?').get(slideId);
    if (!existing) {
      throw new Error('Slide not found.');
    }
    db.prepare('DELETE FROM hero_slides WHERE id = ?').run(slideId);

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'delete_hero_slide',
      targetType: 'hero_slide',
      targetRef: `Slide #${slideId}`,
      details: `Super Admin removed Marketplace hero slide #${slideId}.`,
    });
  });

  res.json({ ok: true });
});

adminRouter.patch('/slides-config', (req: AuthenticatedRequest, res) => {
  const { autoplay, interval_ms } = req.body as { autoplay?: boolean; interval_ms?: number };
  const admin = req.authUser!;
  const ts = nowIso();

  runInTransaction(() => {
    const upsert = db.prepare(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    if (autoplay !== undefined) {
      upsert.run('hero_autoplay', autoplay ? 'true' : 'false', ts);
    }
    if (interval_ms !== undefined && Number.isFinite(Number(interval_ms))) {
      const clamped = Math.max(2000, Math.min(20000, Number(interval_ms)));
      upsert.run('hero_slide_interval_ms', String(clamped), ts);
    }

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'update_slideshow_config',
      targetType: 'system_settings',
      targetRef: 'Marketplace Slideshow',
      details: `Super Admin updated Marketplace hero slideshow playback settings.`,
    });
  });

  res.json({ ok: true });
});

// ========================
// HOMEPAGE FIRST-VISIT POPUP BANNER MANAGER
// ========================

const VALID_POSITIONS = ['top', 'center', 'bottom', 'below_image'] as const;
const VALID_ALIGNS = ['left', 'center', 'right'] as const;
const VALID_ORDERS = ['headline_first', 'description_first'] as const;
const VALID_OVERLAYS = ['dark_scrim', 'navy_banner', 'light_card', 'transparent'] as const;
const VALID_COLORS = ['white', 'navy', 'gold'] as const;
const VALID_TRIGGERS = [
  'first_visit',
  'delay_seconds',
  'scroll_percent',
  'click_count',
  'interaction_target',
] as const;
const VALID_INTERACTIONS = [
  'any',
  'category_filter',
  'search_input',
  'product_card',
  'cart_button',
  'storage_apply',
] as const;
const VALID_FREQUENCIES = ['once_ever', 'once_per_session', 'every_visit'] as const;

interface PopupBody {
  title?: string;
  is_enabled?: boolean;
  image_url?: string;
  headline?: string;
  description?: string;
  cta_label?: string;
  text_position?: string;
  text_align?: string;
  text_order?: string;
  overlay_style?: string;
  text_color?: string;
  trigger_type?: string;
  trigger_delay_seconds?: number;
  trigger_scroll_percent?: number;
  trigger_click_threshold?: number;
  trigger_interaction_target?: string;
  display_frequency?: string;
}

function normalizePopupFields(body: PopupBody) {
  const cleanImage = (body.image_url || '').trim();
  const pos = VALID_POSITIONS.includes(body.text_position as (typeof VALID_POSITIONS)[number])
    ? (body.text_position as (typeof VALID_POSITIONS)[number])
    : 'bottom';
  const align = VALID_ALIGNS.includes(body.text_align as (typeof VALID_ALIGNS)[number])
    ? (body.text_align as (typeof VALID_ALIGNS)[number])
    : 'left';
  const order = VALID_ORDERS.includes(body.text_order as (typeof VALID_ORDERS)[number])
    ? (body.text_order as (typeof VALID_ORDERS)[number])
    : 'headline_first';
  const overlay = VALID_OVERLAYS.includes(body.overlay_style as (typeof VALID_OVERLAYS)[number])
    ? (body.overlay_style as (typeof VALID_OVERLAYS)[number])
    : 'dark_scrim';
  const color = VALID_COLORS.includes(body.text_color as (typeof VALID_COLORS)[number])
    ? (body.text_color as (typeof VALID_COLORS)[number])
    : 'white';
  const triggerType = VALID_TRIGGERS.includes(body.trigger_type as (typeof VALID_TRIGGERS)[number])
    ? (body.trigger_type as (typeof VALID_TRIGGERS)[number])
    : 'first_visit';
  const interactionTarget = VALID_INTERACTIONS.includes(
    body.trigger_interaction_target as (typeof VALID_INTERACTIONS)[number]
  )
    ? (body.trigger_interaction_target as (typeof VALID_INTERACTIONS)[number])
    : 'any';
  const frequency = VALID_FREQUENCIES.includes(
    body.display_frequency as (typeof VALID_FREQUENCIES)[number]
  )
    ? (body.display_frequency as (typeof VALID_FREQUENCIES)[number])
    : 'once_ever';

  const delaySec = Math.max(0, Math.min(300, Math.round(Number(body.trigger_delay_seconds ?? 3) || 0)));
  const scrollPct = Math.max(5, Math.min(95, Math.round(Number(body.trigger_scroll_percent ?? 40) || 40)));
  const clickThresh = Math.max(1, Math.min(50, Math.round(Number(body.trigger_click_threshold ?? 3) || 3)));

  return {
    title: (body.title || '').trim(),
    is_enabled: body.is_enabled !== false,
    image_url: cleanImage,
    headline: (body.headline || '').trim(),
    description: (body.description || '').trim(),
    cta_label: (body.cta_label || '').trim(),
    text_position: pos,
    text_align: align,
    text_order: order,
    overlay_style: overlay,
    text_color: color,
    trigger_type: triggerType,
    trigger_delay_seconds: delaySec,
    trigger_scroll_percent: scrollPct,
    trigger_click_threshold: clickThresh,
    trigger_interaction_target: interactionTarget,
    display_frequency: frequency,
  };
}

adminRouter.get('/popup-banners', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, is_enabled, image_url, headline, description, cta_label,
              text_position, text_align, text_order, overlay_style, text_color,
              trigger_type, trigger_delay_seconds, trigger_scroll_percent,
              trigger_click_threshold, trigger_interaction_target, display_frequency,
              sort_order, created_at, updated_at
       FROM popup_banners
       ORDER BY sort_order ASC, id ASC`
    )
    .all() as Array<Record<string, unknown>>;

  res.json({
    popups: rows.map((r) => ({ ...r, is_enabled: r.is_enabled === 1 })),
  });
});

adminRouter.post('/popup-banners', (req: AuthenticatedRequest, res) => {
  const body = req.body as PopupBody;
  const f = normalizePopupFields(body);
  if (!f.image_url) {
    res.status(400).json({ error: 'Please upload or choose a promotional image for the popup.' });
    return;
  }

  const admin = req.authUser!;
  const ts = nowIso();
  const created = runInTransaction(() => {
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_ord FROM popup_banners')
      .get() as { max_ord: number };
    const nextSort = maxRow.max_ord + 1;
    const title = f.title || f.headline || `Popup Banner #${nextSort}`;

    const result = db
      .prepare(
        `INSERT INTO popup_banners (
          title, is_enabled, image_url, headline, description, cta_label,
          text_position, text_align, text_order, overlay_style, text_color,
          trigger_type, trigger_delay_seconds, trigger_scroll_percent,
          trigger_click_threshold, trigger_interaction_target, display_frequency,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title,
        f.is_enabled ? 1 : 0,
        f.image_url,
        f.headline,
        f.description,
        f.cta_label,
        f.text_position,
        f.text_align,
        f.text_order,
        f.overlay_style,
        f.text_color,
        f.trigger_type,
        f.trigger_delay_seconds,
        f.trigger_scroll_percent,
        f.trigger_click_threshold,
        f.trigger_interaction_target,
        f.display_frequency,
        nextSort,
        ts,
        ts
      );

    const newId = Number(result.lastInsertRowid);
    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'create_popup_banner',
      targetType: 'popup_banner',
      targetRef: `Popup #${newId}`,
      details: `Super Admin created popup banner "${title}" (trigger: ${f.trigger_type}, frequency: ${f.display_frequency}).`,
    });

    return {
      id: newId,
      ...f,
      title,
      sort_order: nextSort,
      created_at: ts,
      updated_at: ts,
    };
  });

  res.status(201).json({ popup: created });
});

adminRouter.patch('/popup-banners/:id', (req: AuthenticatedRequest, res) => {
  const popupId = Number(req.params.id);
  const body = req.body as PopupBody;
  const admin = req.authUser!;

  try {
    const updated = runInTransaction(() => {
      const existing = db
        .prepare('SELECT * FROM popup_banners WHERE id = ?')
        .get(popupId) as Record<string, unknown> | undefined;
      if (!existing) {
        throw new Error('Popup banner not found.');
      }

      const merged = normalizePopupFields({
        title: body.title !== undefined ? body.title : String(existing.title || ''),
        is_enabled: body.is_enabled !== undefined ? body.is_enabled : existing.is_enabled === 1,
        image_url: body.image_url !== undefined ? body.image_url : String(existing.image_url || ''),
        headline: body.headline !== undefined ? body.headline : String(existing.headline || ''),
        description: body.description !== undefined ? body.description : String(existing.description || ''),
        cta_label: body.cta_label !== undefined ? body.cta_label : String(existing.cta_label || ''),
        text_position: body.text_position ?? String(existing.text_position),
        text_align: body.text_align ?? String(existing.text_align),
        text_order: body.text_order ?? String(existing.text_order),
        overlay_style: body.overlay_style ?? String(existing.overlay_style),
        text_color: body.text_color ?? String(existing.text_color),
        trigger_type: body.trigger_type ?? String(existing.trigger_type),
        trigger_delay_seconds:
          body.trigger_delay_seconds ?? Number(existing.trigger_delay_seconds ?? 3),
        trigger_scroll_percent:
          body.trigger_scroll_percent ?? Number(existing.trigger_scroll_percent ?? 40),
        trigger_click_threshold:
          body.trigger_click_threshold ?? Number(existing.trigger_click_threshold ?? 3),
        trigger_interaction_target:
          body.trigger_interaction_target ?? String(existing.trigger_interaction_target ?? 'any'),
        display_frequency: body.display_frequency ?? String(existing.display_frequency ?? 'once_ever'),
      });

      if (merged.is_enabled && !merged.image_url) {
        throw new Error('Promotional image is required when enabling a popup banner.');
      }

      const ts = nowIso();
      const title = merged.title || merged.headline || `Popup Banner #${popupId}`;

      db.prepare(
        `UPDATE popup_banners
         SET title = ?, is_enabled = ?, image_url = ?, headline = ?, description = ?, cta_label = ?,
             text_position = ?, text_align = ?, text_order = ?, overlay_style = ?, text_color = ?,
             trigger_type = ?, trigger_delay_seconds = ?, trigger_scroll_percent = ?,
             trigger_click_threshold = ?, trigger_interaction_target = ?, display_frequency = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        title,
        merged.is_enabled ? 1 : 0,
        merged.image_url,
        merged.headline,
        merged.description,
        merged.cta_label,
        merged.text_position,
        merged.text_align,
        merged.text_order,
        merged.overlay_style,
        merged.text_color,
        merged.trigger_type,
        merged.trigger_delay_seconds,
        merged.trigger_scroll_percent,
        merged.trigger_click_threshold,
        merged.trigger_interaction_target,
        merged.display_frequency,
        ts,
        popupId
      );

      recordAuditLog({
        actorUserId: admin.id,
        actorLabel: 'Super Admin',
        actorRole: 'super_admin',
        action: 'update_popup_banner',
        targetType: 'popup_banner',
        targetRef: `Popup #${popupId}`,
        details: `Super Admin updated popup "${title}" (${merged.is_enabled ? 'Enabled' : 'Disabled'}, trigger: ${merged.trigger_type}/${merged.display_frequency}).`,
      });

      return {
        id: popupId,
        ...merged,
        title,
        sort_order: Number(existing.sort_order ?? popupId),
        created_at: String(existing.created_at || ts),
        updated_at: ts,
      };
    });

    res.json({ popup: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update popup banner.' });
  }
});

adminRouter.post('/popup-banners/reorder', (req: AuthenticatedRequest, res) => {
  const { ordered_ids } = req.body as { ordered_ids?: number[] };
  if (!Array.isArray(ordered_ids) || ordered_ids.length === 0) {
    res.status(400).json({ error: 'ordered_ids array is required.' });
    return;
  }

  const admin = req.authUser!;
  runInTransaction(() => {
    const stmt = db.prepare('UPDATE popup_banners SET sort_order = ? WHERE id = ?');
    ordered_ids.forEach((id, idx) => {
      stmt.run(idx + 1, Number(id));
    });

    recordAuditLog({
      actorUserId: admin.id,
      actorLabel: 'Super Admin',
      actorRole: 'super_admin',
      action: 'reorder_popup_banners',
      targetType: 'popup_banner',
      targetRef: 'Homepage Popups',
      details: `Super Admin reordered ${ordered_ids.length} homepage popup banners.`,
    });
  });

  res.json({ ok: true });
});

adminRouter.delete('/popup-banners/:id', (req: AuthenticatedRequest, res) => {
  const popupId = Number(req.params.id);
  const admin = req.authUser!;

  try {
    runInTransaction(() => {
      const existing = db
        .prepare('SELECT id, title FROM popup_banners WHERE id = ?')
        .get(popupId) as { id: number; title: string } | undefined;
      if (!existing) {
        throw new Error('Popup banner not found.');
      }
      db.prepare('DELETE FROM popup_banners WHERE id = ?').run(popupId);

      recordAuditLog({
        actorUserId: admin.id,
        actorLabel: 'Super Admin',
        actorRole: 'super_admin',
        action: 'delete_popup_banner',
        targetType: 'popup_banner',
        targetRef: `Popup #${popupId}`,
        details: `Super Admin deleted popup banner "${existing.title}".`,
      });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Popup banner not found.' });
  }
});

adminRouter.get('/popup-banner', (_req, res) => {
  const row = db
    .prepare(
      `SELECT id, title, is_enabled, image_url, headline, description, cta_label,
              text_position, text_align, text_order, overlay_style, text_color,
              trigger_type, trigger_delay_seconds, trigger_scroll_percent,
              trigger_click_threshold, trigger_interaction_target, display_frequency,
              sort_order, updated_at
       FROM popup_banners ORDER BY sort_order ASC, id ASC LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;

  res.json({
    popup: row ? { ...row, is_enabled: row.is_enabled === 1 } : null,
  });
});

adminRouter.put('/popup-banner', (req: AuthenticatedRequest, res) => {
  const f = normalizePopupFields(req.body as PopupBody);
  if (f.is_enabled && !f.image_url) {
    res.status(400).json({ error: 'Please upload or select a promotional image before enabling the popup banner.' });
    return;
  }

  const admin = req.authUser!;
  const ts = nowIso();
  const saved = runInTransaction(() => {
    const first = db
      .prepare('SELECT id FROM popup_banners ORDER BY sort_order ASC, id ASC LIMIT 1')
      .get() as { id: number } | undefined;

    if (first) {
      db.prepare(
        `UPDATE popup_banners
         SET is_enabled = ?, image_url = ?, headline = ?, description = ?, cta_label = ?,
             text_position = ?, text_align = ?, text_order = ?, overlay_style = ?, text_color = ?,
             trigger_type = ?, trigger_delay_seconds = ?, trigger_scroll_percent = ?,
             trigger_click_threshold = ?, trigger_interaction_target = ?, display_frequency = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        f.is_enabled ? 1 : 0,
        f.image_url,
        f.headline,
        f.description,
        f.cta_label,
        f.text_position,
        f.text_align,
        f.text_order,
        f.overlay_style,
        f.text_color,
        f.trigger_type,
        f.trigger_delay_seconds,
        f.trigger_scroll_percent,
        f.trigger_click_threshold,
        f.trigger_interaction_target,
        f.display_frequency,
        ts,
        first.id
      );
      return { id: first.id, ...f, updated_at: ts };
    }

    const inserted = db
      .prepare(
        `INSERT INTO popup_banners (
          title, is_enabled, image_url, headline, description, cta_label,
          text_position, text_align, text_order, overlay_style, text_color,
          trigger_type, trigger_delay_seconds, trigger_scroll_percent,
          trigger_click_threshold, trigger_interaction_target, display_frequency,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        f.title || f.headline || 'Homepage Popup Banner',
        f.is_enabled ? 1 : 0,
        f.image_url,
        f.headline,
        f.description,
        f.cta_label,
        f.text_position,
        f.text_align,
        f.text_order,
        f.overlay_style,
        f.text_color,
        f.trigger_type,
        f.trigger_delay_seconds,
        f.trigger_scroll_percent,
        f.trigger_click_threshold,
        f.trigger_interaction_target,
        f.display_frequency,
        ts,
        ts
      );
    return { id: Number(inserted.lastInsertRowid), ...f, updated_at: ts };
  });

  recordAuditLog({
    actorUserId: admin.id,
    actorLabel: 'Super Admin',
    actorRole: 'super_admin',
    action: 'update_popup_banner',
    targetType: 'popup_banner',
    targetRef: 'Homepage Popup',
    details: `Super Admin updated Homepage Popup Banner (${f.is_enabled ? 'Enabled' : 'Disabled'}).`,
  });

  res.json({ popup: saved });
});
