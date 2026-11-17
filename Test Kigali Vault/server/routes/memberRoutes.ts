import { Router } from 'express';
import {
  type AuthenticatedRequest,
  getActorLabel,
  recordAuditLog,
  requireAuth,
  requireRole,
} from '../auth.ts';
import { db, nowIso, runInTransaction } from '../db.ts';

export const memberRouter = Router();

memberRouter.use(requireAuth);

// Accessible by pending/rejected/active members so applicants can see their own status
memberRouter.get('/application-status', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.role !== 'member') {
    res.status(403).json({ error: 'Only member accounts have storage applications.' });
    return;
  }

  const profile = db
    .prepare(
      `SELECT business_name, storage_id, application_status, requested_space_sqm,
              allocated_space_sqm, occupied_space_sqm, monthly_rental_fee,
              notes, rejection_reason, reviewed_at, created_at
       FROM member_profiles WHERE user_id = ?`
    )
    .get(user.id);

  res.json({ application: profile });
});

// Active member portal endpoints strictly enforce role='member' and status='active'
memberRouter.use(requireRole('member'));

function getMemberProfileOrFail(userId: number) {
  return db
    .prepare(
      `SELECT id, user_id, business_name, storage_id, application_status,
              requested_space_sqm, allocated_space_sqm, occupied_space_sqm,
              monthly_rental_fee, notes, created_at
       FROM member_profiles WHERE user_id = ?`
    )
    .get(userId) as
    | {
        id: number;
        user_id: number;
        business_name: string;
        storage_id: string | null;
        application_status: string;
        requested_space_sqm: number;
        allocated_space_sqm: number;
        occupied_space_sqm: number;
        monthly_rental_fee: number;
        notes: string;
        created_at: string;
      }
    | undefined;
}

memberRouter.get('/dashboard', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const profile = getMemberProfileOrFail(user.id);
  if (!profile || profile.application_status !== 'approved') {
    res.status(403).json({ error: 'Storage membership is not approved yet.' });
    return;
  }

  const productStats = db
    .prepare(
      `SELECT COUNT(*) AS total_listings,
              COALESCE(SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END), 0) AS active_listings,
              COALESCE(SUM(available_qty), 0) AS remaining_units,
              COALESCE(SUM(sold_qty), 0) AS sold_units
       FROM product_listings WHERE member_id = ?`
    )
    .get(profile.id) as {
    total_listings: number;
    active_listings: number;
    remaining_units: number;
    sold_units: number;
  };

  const salesStats = db
    .prepare(
      `SELECT COUNT(*) AS completed_transactions,
              COALESCE(SUM(quantity_sold), 0) AS total_units_sold,
              COALESCE(SUM(total_amount), 0) AS total_revenue
       FROM sales_transactions WHERE member_id = ?`
    )
    .get(profile.id) as {
    completed_transactions: number;
    total_units_sold: number;
    total_revenue: number;
  };

  const unreadCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(user.id) as { cnt: number };

  const recentNotifications = db
    .prepare(
      `SELECT id, category, title, message, is_read, created_at
       FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 8`
    )
    .all(user.id);

  const recentSales = db
    .prepare(
      `SELECT s.order_reference, s.product_name, s.quantity_sold, s.unit_price,
              s.total_amount, s.created_at, o.status AS order_status
       FROM sales_transactions s
       JOIN orders o ON o.id = s.order_id
       WHERE s.member_id = ?
       ORDER BY s.created_at DESC LIMIT 5`
    )
    .all(profile.id);

  res.json({
    storage: {
      storage_id: profile.storage_id,
      business_name: profile.business_name,
      allocated_space_sqm: profile.allocated_space_sqm,
      occupied_space_sqm: profile.occupied_space_sqm,
      remaining_capacity_sqm: Math.max(0, profile.allocated_space_sqm - profile.occupied_space_sqm),
      monthly_rental_fee: profile.monthly_rental_fee,
    },
    product_summary: productStats,
    sales_summary: salesStats,
    unread_notifications: unreadCountRow.cnt,
    recent_notifications: recentNotifications,
    recent_sales: recentSales,
  });
});

memberRouter.get('/products', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const profile = getMemberProfileOrFail(user.id);
  if (!profile) {
    res.status(404).json({ error: 'Member profile not found.' });
    return;
  }

  // Note: Never expose internal listing IDs or internal_ref to UI
  const products = db
    .prepare(
      `SELECT name, category, description, unit_label, price,
              initial_qty, sold_qty, available_qty, space_per_unit_sqm,
              image_url, gallery_urls, status, created_at, updated_at
       FROM product_listings
       WHERE member_id = ?
       ORDER BY created_at DESC`
    )
    .all(profile.id) as Array<{
    name: string;
    category: string;
    description: string;
    unit_label: string;
    price: number;
    initial_qty: number;
    sold_qty: number;
    available_qty: number;
    space_per_unit_sqm: number;
    image_url: string;
    gallery_urls: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  res.json({
    products: products.map((p) => ({
      ...p,
      gallery_urls: (() => {
        try {
          return JSON.parse(p.gallery_urls) as string[];
        } catch {
          return [p.image_url];
        }
      })(),
    })),
  });
});

memberRouter.get('/sales', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const profile = getMemberProfileOrFail(user.id);
  if (!profile) {
    res.status(404).json({ error: 'Member profile not found.' });
    return;
  }

  // Strictly excludes customer name, phone, and address to protect customer privacy!
  const sales = db
    .prepare(
      `SELECT oi.product_name,
              oi.quantity AS quantity_sold,
              oi.unit_label,
              oi.unit_price,
              oi.subtotal AS total_amount,
              o.order_reference,
              o.status AS order_status,
              COALESCE(o.completed_at, o.created_at) AS sale_date
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.member_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(profile.id);

  res.json({ sales });
});

memberRouter.get('/storage', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const profile = getMemberProfileOrFail(user.id);
  if (!profile) {
    res.status(404).json({ error: 'Member profile not found.' });
    return;
  }

  const history = db
    .prepare(
      `SELECT change_type, previous_space_sqm, new_space_sqm,
              previous_fee, new_fee, note, created_at
       FROM storage_allocation_history
       WHERE member_id = ?
       ORDER BY created_at DESC`
    )
    .all(profile.id);

  const requests = db
    .prepare(
      `SELECT id, requested_extra_sqm, proposed_fee_increase, reason,
              status, staff_note, reviewed_at, created_at
       FROM additional_storage_requests
       WHERE member_id = ?
       ORDER BY created_at DESC`
    )
    .all(profile.id);

  const rateSetting = db
    .prepare("SELECT value FROM system_settings WHERE key = 'base_rate_per_sqm'")
    .get() as { value: string } | undefined;

  res.json({
    storage: {
      storage_id: profile.storage_id,
      business_name: profile.business_name,
      allocated_space_sqm: profile.allocated_space_sqm,
      occupied_space_sqm: profile.occupied_space_sqm,
      remaining_capacity_sqm: Math.max(0, profile.allocated_space_sqm - profile.occupied_space_sqm),
      monthly_rental_fee: profile.monthly_rental_fee,
      base_rate_per_sqm: Number(rateSetting?.value || 1500),
    },
    history,
    requests,
  });
});

memberRouter.post('/storage-requests', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const profile = getMemberProfileOrFail(user.id);
  if (!profile || profile.application_status !== 'approved' || !profile.storage_id) {
    res.status(403).json({ error: 'Approved storage membership is required.' });
    return;
  }

  const { requested_extra_sqm, reason } = req.body as {
    requested_extra_sqm?: number;
    reason?: string;
  };
  const extra = Number(requested_extra_sqm);
  if (!Number.isFinite(extra) || extra < 5 || extra > 2000) {
    res.status(400).json({ error: 'Additional space request must be between 5 and 2,000 sqm.' });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: 'Please explain your additional storage requirement.' });
    return;
  }

  const rateSetting = db
    .prepare("SELECT value FROM system_settings WHERE key = 'base_rate_per_sqm'")
    .get() as { value: string } | undefined;
  const ratePerSqm = Number(rateSetting?.value || 1500);
  const feeIncrease = extra * ratePerSqm;

  const created = runInTransaction(() => {
    const ts = nowIso();
    const r = db
      .prepare(
        `INSERT INTO additional_storage_requests (
          member_id, storage_id, requested_extra_sqm, proposed_fee_increase,
          reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'Pending', ?)`
      )
      .run(profile.id, profile.storage_id, extra, feeIncrease, reason.trim(), ts);

    recordAuditLog({
      actorUserId: user.id,
      actorLabel: getActorLabel(user),
      actorRole: 'member',
      action: 'request_additional_storage',
      targetType: 'storage_request',
      targetRef: profile.storage_id!,
      details: `${profile.storage_id} requested +${extra} sqm additional warehouse capacity.`,
    });

    return {
      id: Number(r.lastInsertRowid),
      requested_extra_sqm: extra,
      proposed_fee_increase: feeIncrease,
      reason: reason.trim(),
      status: 'Pending',
      created_at: ts,
    };
  });

  res.status(201).json({ request: created });
});

memberRouter.get('/notifications', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const notifications = db
    .prepare(
      `SELECT id, category, title, message, is_read, created_at
       FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .all(user.id);
  const unread = db
    .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(user.id) as { cnt: number };

  res.json({ notifications, unread_count: unread.cnt });
});

memberRouter.post('/notifications/read', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { notification_id } = req.body as { notification_id?: number };

  if (notification_id) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
      notification_id,
      user.id
    );
  } else {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
  }

  res.json({ ok: true });
});

memberRouter.get('/reports', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const profile = getMemberProfileOrFail(user.id);
  if (!profile) {
    res.status(404).json({ error: 'Member profile not found.' });
    return;
  }

  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let dateClause = '';
  const params: Array<string | number> = [profile.id];
  if (from) {
    dateClause += ' AND DATE(created_at) >= DATE(?)';
    params.push(from);
  }
  if (to) {
    dateClause += ' AND DATE(created_at) <= DATE(?)';
    params.push(to);
  }

  const byProduct = db
    .prepare(
      `SELECT product_name,
              SUM(quantity_sold) AS units_sold,
              SUM(total_amount) AS revenue,
              COUNT(*) AS sale_count
       FROM sales_transactions
       WHERE member_id = ? ${dateClause}
       GROUP BY product_name
       ORDER BY revenue DESC`
    )
    .all(...params);

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS total_transactions,
              COALESCE(SUM(quantity_sold), 0) AS total_units_sold,
              COALESCE(SUM(total_amount), 0) AS total_revenue
       FROM sales_transactions
       WHERE member_id = ? ${dateClause}`
    )
    .get(...params);

  res.json({
    summary,
    by_product: byProduct,
    storage: {
      storage_id: profile.storage_id,
      allocated_space_sqm: profile.allocated_space_sqm,
      occupied_space_sqm: profile.occupied_space_sqm,
      remaining_capacity_sqm: Math.max(0, profile.allocated_space_sqm - profile.occupied_space_sqm),
    },
  });
});

// Explicitly block any member attempt to mutate products
memberRouter.all('/products*', (_req, res) => {
  res.status(403).json({
    error: 'Forbidden: Product registration and inventory changes are exclusively managed by authorized warehouse staff.',
  });
});
