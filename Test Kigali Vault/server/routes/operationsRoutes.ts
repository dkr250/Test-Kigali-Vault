import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import {
  type AuthenticatedRequest,
  getActorLabel,
  notifyUser,
  recordAuditLog,
  requireAuth,
  requireOperationsPermission,
  requireRole,
} from '../auth.ts';
import { db, generateInternalRef, getUploadsDir, nowIso, runInTransaction } from '../db.ts';
import { emitOrderUpdate, subscribeOrderUpdates } from '../orderEvents.ts';

export const operationsRouter = Router();

operationsRouter.use(requireAuth, requireRole('staff', 'super_admin'));

operationsRouter.get('/summary', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const isAdmin = user.role === 'super_admin';
  const perms = user.staff_permissions;

  const pendingApps =
    isAdmin || perms?.can_manage_storage
      ? (
          db
            .prepare("SELECT COUNT(*) AS cnt FROM member_profiles WHERE application_status = 'pending'")
            .get() as { cnt: number }
        ).cnt
      : 0;

  const pendingRequests =
    isAdmin || perms?.can_manage_storage
      ? (
          db
            .prepare("SELECT COUNT(*) AS cnt FROM additional_storage_requests WHERE status = 'Pending'")
            .get() as { cnt: number }
        ).cnt
      : 0;

  const activeListings =
    isAdmin || perms?.can_manage_inventory
      ? (
          db
            .prepare("SELECT COUNT(*) AS cnt FROM product_listings WHERE status != 'Archived'")
            .get() as { cnt: number }
        ).cnt
      : 0;

  const openOrders =
    isAdmin || perms?.can_manage_orders
      ? (
          db
            .prepare(
              "SELECT COUNT(*) AS cnt FROM orders WHERE status NOT IN ('Completed', 'Cancelled')"
            )
            .get() as { cnt: number }
        ).cnt
      : 0;

  res.json({
    pending_applications: pendingApps,
    pending_storage_requests: pendingRequests,
    active_listings: activeListings,
    open_orders: openOrders,
  });
});

// ========================
// STORAGE OPERATIONS
// ========================

operationsRouter.get(
  '/storage-applications',
  requireOperationsPermission('can_manage_storage'),
  (_req, res) => {
    const rows = db
      .prepare(
        `SELECT m.id, m.business_name, m.storage_id, m.application_status,
                m.requested_space_sqm, m.allocated_space_sqm, m.occupied_space_sqm,
                m.monthly_rental_fee, m.notes, m.rejection_reason, m.reviewed_at, m.created_at,
                u.full_name, u.email, u.phone, u.status AS user_status
         FROM member_profiles m
         JOIN users u ON u.id = m.user_id
         ORDER BY CASE m.application_status WHEN 'pending' THEN 0 ELSE 1 END, m.created_at DESC`
      )
      .all();

    const rateRow = db
      .prepare("SELECT value FROM system_settings WHERE key = 'base_rate_per_sqm'")
      .get() as { value: string } | undefined;

    res.json({
      applications: rows,
      base_rate_per_sqm: Number(rateRow?.value || 1500),
    });
  }
);

operationsRouter.post(
  '/storage-applications/:memberId/review',
  requireOperationsPermission('can_manage_storage'),
  (req: AuthenticatedRequest, res) => {
    const memberId = Number(req.params.memberId);
    const { decision, allocated_space_sqm, monthly_rental_fee, note, rejection_reason } = req.body as {
      decision?: 'approve' | 'reject';
      allocated_space_sqm?: number;
      monthly_rental_fee?: number;
      note?: string;
      rejection_reason?: string;
    };

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ error: 'Decision must be approve or reject.' });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      const updated = runInTransaction(() => {
        const member = db
          .prepare(
            `SELECT m.id, m.user_id, m.business_name, m.storage_id, m.application_status, m.requested_space_sqm
             FROM member_profiles m WHERE m.id = ?`
          )
          .get(memberId) as
          | {
              id: number;
              user_id: number;
              business_name: string;
              storage_id: string | null;
              application_status: string;
              requested_space_sqm: number;
            }
          | undefined;

        if (!member) {
          throw new Error('Member application not found.');
        }
        if (member.application_status !== 'pending') {
          throw new Error('This application has already been reviewed.');
        }

        const ts = nowIso();

        if (decision === 'reject') {
          const reason = (rejection_reason || 'Application did not meet current bay availability criteria.').trim();
          db.prepare(
            `UPDATE member_profiles
             SET application_status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?
             WHERE id = ?`
          ).run(reason, actor.id, ts, member.id);

          db.prepare("UPDATE users SET status = 'rejected', updated_at = ? WHERE id = ?").run(
            ts,
            member.user_id
          );

          notifyUser({
            userId: member.user_id,
            category: 'storage_request',
            title: 'Storage Application Update',
            message: `Your storage application for ${member.business_name} was not approved. Note: ${reason}`,
          });

          recordAuditLog({
            actorUserId: actor.id,
            actorLabel,
            actorRole: actor.role,
            action: 'reject_storage_application',
            targetType: 'member_application',
            targetRef: member.business_name,
            details: `${actorLabel} rejected storage application for ${member.business_name}.`,
          });

          return { status: 'rejected', storage_id: null };
        }

        // Approve: guarantee permanent unique Storage ID, never reused
        if (member.storage_id) {
          throw new Error('Member already has a permanent Storage ID.');
        }

        const space = Number(allocated_space_sqm || member.requested_space_sqm);
        if (!Number.isFinite(space) || space <= 0) {
          throw new Error('Allocated space must be greater than zero.');
        }

        const rateRow = db
          .prepare("SELECT value FROM system_settings WHERE key = 'base_rate_per_sqm'")
          .get() as { value: string } | undefined;
        const defaultFee = space * Number(rateRow?.value || 1500);
        const fee = Number.isFinite(Number(monthly_rental_fee)) && Number(monthly_rental_fee) >= 0
          ? Number(monthly_rental_fee)
          : defaultFee;

        // Atomically increment monotonic counter
        db.prepare('UPDATE storage_id_counter SET last_seq = last_seq + 1 WHERE id = 1').run();
        const counterRow = db
          .prepare('SELECT last_seq FROM storage_id_counter WHERE id = 1')
          .get() as { last_seq: number };
        const storageId = `WH-${String(counterRow.last_seq).padStart(4, '0')}`;

        db.prepare(
          `UPDATE member_profiles
           SET storage_id = ?, application_status = 'approved',
               allocated_space_sqm = ?, monthly_rental_fee = ?,
               reviewed_by = ?, reviewed_at = ?
           WHERE id = ?`
        ).run(storageId, space, fee, actor.id, ts, member.id);

        db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(
          ts,
          member.user_id
        );

        db.prepare(
          `INSERT INTO storage_allocation_history (
            member_id, storage_id, change_type, previous_space_sqm, new_space_sqm,
            previous_fee, new_fee, note, performed_by, created_at
          ) VALUES (?, ?, 'initial_allocation', 0, ?, 0, ?, ?, ?, ?)`
        ).run(
          member.id,
          storageId,
          space,
          fee,
          (note || `Initial storage bay allocated under permanent ID ${storageId}.`).trim(),
          actor.id,
          ts
        );

        notifyUser({
          userId: member.user_id,
          category: 'storage_allocation',
          title: `Storage Approved · ${storageId}`,
          message: `Welcome to Kigali Vault. Your permanent Storage ID is ${storageId} with ${space} sqm allocated (${fee.toLocaleString()} RWF/month).`,
        });

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: 'approve_storage_application',
          targetType: 'member_profile',
          targetRef: storageId,
          details: `${actorLabel} approved ${member.business_name} and assigned permanent Storage ID ${storageId} (${space} sqm).`,
        });

        return { status: 'approved', storage_id: storageId };
      });

      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Review failed.' });
    }
  }
);

operationsRouter.get(
  '/storage-requests',
  requireOperationsPermission('can_manage_storage'),
  (_req, res) => {
    const requests = db
      .prepare(
        `SELECT r.id, r.member_id, r.storage_id, r.requested_extra_sqm,
                r.proposed_fee_increase, r.reason, r.status, r.staff_note,
                r.reviewed_at, r.created_at,
                m.business_name, m.allocated_space_sqm, m.occupied_space_sqm, m.monthly_rental_fee
         FROM additional_storage_requests r
         JOIN member_profiles m ON m.id = r.member_id
         ORDER BY CASE r.status WHEN 'Pending' THEN 0 ELSE 1 END, r.created_at DESC`
      )
      .all();

    res.json({ requests });
  }
);

operationsRouter.post(
  '/storage-requests/:reqId/review',
  requireOperationsPermission('can_manage_storage'),
  (req: AuthenticatedRequest, res) => {
    const reqId = Number(req.params.reqId);
    const { decision, approved_extra_sqm, fee_increase, staff_note } = req.body as {
      decision?: 'approve' | 'reject';
      approved_extra_sqm?: number;
      fee_increase?: number;
      staff_note?: string;
    };

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ error: 'Decision must be approve or reject.' });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      const result = runInTransaction(() => {
        const requestRow = db
          .prepare(
            `SELECT r.id, r.member_id, r.storage_id, r.requested_extra_sqm,
                    r.proposed_fee_increase, r.status,
                    m.user_id, m.allocated_space_sqm, m.monthly_rental_fee, m.business_name
             FROM additional_storage_requests r
             JOIN member_profiles m ON m.id = r.member_id
             WHERE r.id = ?`
          )
          .get(reqId) as
          | {
              id: number;
              member_id: number;
              storage_id: string;
              requested_extra_sqm: number;
              proposed_fee_increase: number;
              status: string;
              user_id: number;
              allocated_space_sqm: number;
              monthly_rental_fee: number;
              business_name: string;
            }
          | undefined;

        if (!requestRow) {
          throw new Error('Additional storage request not found.');
        }
        if (requestRow.status !== 'Pending') {
          throw new Error('Request has already been processed.');
        }

        const ts = nowIso();

        if (decision === 'reject') {
          const note = (staff_note || 'Additional adjacent bay capacity unavailable at this time.').trim();
          db.prepare(
            `UPDATE additional_storage_requests
             SET status = 'Rejected', staff_note = ?, reviewed_by = ?, reviewed_at = ?
             WHERE id = ?`
          ).run(note, actor.id, ts, requestRow.id);

          notifyUser({
            userId: requestRow.user_id,
            category: 'storage_request',
            title: `Additional Storage Request Rejected · ${requestRow.storage_id}`,
            message: `Your request for +${requestRow.requested_extra_sqm} sqm was declined. Note: ${note}`,
          });

          recordAuditLog({
            actorUserId: actor.id,
            actorLabel,
            actorRole: actor.role,
            action: 'reject_additional_storage',
            targetType: 'storage_request',
            targetRef: requestRow.storage_id,
            details: `${actorLabel} rejected additional storage (+${requestRow.requested_extra_sqm} sqm) for ${requestRow.storage_id}.`,
          });

          return { status: 'Rejected' };
        }

        // Approve: update existing Storage ID allocation and fee (never create a new ID!)
        const extraSqm = Number(approved_extra_sqm || requestRow.requested_extra_sqm);
        const addFee = Number.isFinite(Number(fee_increase))
          ? Number(fee_increase)
          : requestRow.proposed_fee_increase;

        const newSpace = requestRow.allocated_space_sqm + extraSqm;
        const newFee = requestRow.monthly_rental_fee + addFee;

        db.prepare(
          `UPDATE additional_storage_requests
           SET status = 'Approved', staff_note = ?, reviewed_by = ?, reviewed_at = ?
           WHERE id = ?`
        ).run((staff_note || `Approved +${extraSqm} sqm under ${requestRow.storage_id}.`).trim(), actor.id, ts, requestRow.id);

        db.prepare(
          `UPDATE member_profiles
           SET allocated_space_sqm = ?, monthly_rental_fee = ?
           WHERE id = ?`
        ).run(newSpace, newFee, requestRow.member_id);

        db.prepare(
          `INSERT INTO storage_allocation_history (
            member_id, storage_id, change_type, previous_space_sqm, new_space_sqm,
            previous_fee, new_fee, note, performed_by, created_at
          ) VALUES (?, ?, 'expansion_approved', ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          requestRow.member_id,
          requestRow.storage_id,
          requestRow.allocated_space_sqm,
          newSpace,
          requestRow.monthly_rental_fee,
          newFee,
          (staff_note || `Approved additional +${extraSqm} sqm under existing Storage ID ${requestRow.storage_id}.`).trim(),
          actor.id,
          ts
        );

        notifyUser({
          userId: requestRow.user_id,
          category: 'storage_allocation',
          title: `Additional Storage Approved · ${requestRow.storage_id}`,
          message: `Approved +${extraSqm} sqm under ${requestRow.storage_id}. Total allocation is now ${newSpace} sqm and monthly rental fee is ${newFee.toLocaleString()} RWF.`,
        });

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: 'approve_additional_storage',
          targetType: 'storage_allocation',
          targetRef: requestRow.storage_id,
          details: `${actorLabel} approved additional storage (+${extraSqm} sqm) for ${requestRow.storage_id}.`,
        });

        return { status: 'Approved', new_space_sqm: newSpace, new_fee: newFee };
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to review request.' });
    }
  }
);

// ========================
// INVENTORY & PRODUCT MANAGEMENT
// ========================

operationsRouter.get(
  '/categories',
  requireOperationsPermission('can_manage_inventory'),
  (_req, res) => {
    const categories = db
      .prepare('SELECT id, name, sort_order, created_at FROM product_categories ORDER BY sort_order ASC, name ASC')
      .all();
    res.json({ categories });
  }
);

operationsRouter.post(
  '/categories',
  requireOperationsPermission('can_manage_inventory'),
  (req: AuthenticatedRequest, res) => {
    const { name } = req.body as { name?: string };
    const cleanName = (name || '').trim();
    if (!cleanName || cleanName.length < 2 || cleanName.length > 60) {
      res.status(400).json({ error: 'Category name must be between 2 and 60 characters.' });
      return;
    }

    const exists = db
      .prepare('SELECT id FROM product_categories WHERE LOWER(name) = LOWER(?)')
      .get(cleanName);
    if (exists) {
      res.status(409).json({ error: `Category "${cleanName}" already exists.` });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    const created = runInTransaction(() => {
      const maxOrderRow = db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_ord FROM product_categories')
        .get() as { max_ord: number };
      const ts = nowIso();
      const result = db
        .prepare('INSERT INTO product_categories (name, sort_order, created_at) VALUES (?, ?, ?)')
        .run(cleanName, maxOrderRow.max_ord + 1, ts);

      recordAuditLog({
        actorUserId: actor.id,
        actorLabel,
        actorRole: actor.role,
        action: 'create_product_category',
        targetType: 'product_category',
        targetRef: cleanName,
        details: `${actorLabel} added new product category "${cleanName}".`,
      });

      return { id: Number(result.lastInsertRowid), name: cleanName, sort_order: maxOrderRow.max_ord + 1 };
    });

    res.status(201).json({ category: created });
  }
);

operationsRouter.patch(
  '/categories/:id',
  requireOperationsPermission('can_manage_inventory'),
  (req: AuthenticatedRequest, res) => {
    const catId = Number(req.params.id);
    const { name } = req.body as { name?: string };
    const cleanName = (name || '').trim();
    if (!cleanName || cleanName.length < 2 || cleanName.length > 60) {
      res.status(400).json({ error: 'Category name must be between 2 and 60 characters.' });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      const updated = runInTransaction(() => {
        const existing = db
          .prepare('SELECT id, name, sort_order FROM product_categories WHERE id = ?')
          .get(catId) as { id: number; name: string; sort_order: number } | undefined;

        if (!existing) {
          throw new Error('Category not found.');
        }

        const duplicate = db
          .prepare('SELECT id FROM product_categories WHERE LOWER(name) = LOWER(?) AND id != ?')
          .get(cleanName, catId);
        if (duplicate) {
          throw new Error(`Another category named "${cleanName}" already exists.`);
        }

        db.prepare('UPDATE product_categories SET name = ? WHERE id = ?').run(cleanName, catId);
        // Cascade rename to existing product listings so they remain filterable under the updated name
        db.prepare('UPDATE product_listings SET category = ? WHERE category = ?').run(
          cleanName,
          existing.name
        );

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: 'rename_product_category',
          targetType: 'product_category',
          targetRef: cleanName,
          details: `${actorLabel} renamed product category "${existing.name}" to "${cleanName}".`,
        });

        return { id: existing.id, name: cleanName, sort_order: existing.sort_order };
      });

      res.json({ category: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to rename category.' });
    }
  }
);

operationsRouter.get('/approved-members', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const perms = user.staff_permissions;
  if (
    user.role !== 'super_admin' &&
    !perms?.can_manage_inventory &&
    !perms?.can_manage_storage &&
    !perms?.can_assist_members
  ) {
    res.status(403).json({ error: 'Forbidden: insufficient operational permissions.' });
    return;
  }

  const members = db
    .prepare(
      `SELECT m.id, m.storage_id, m.business_name, m.allocated_space_sqm,
              m.occupied_space_sqm, m.monthly_rental_fee, u.full_name, u.phone, u.email
       FROM member_profiles m
       JOIN users u ON u.id = m.user_id
       WHERE m.application_status = 'approved' AND u.status = 'active'
       ORDER BY m.storage_id ASC`
    )
    .all();

  res.json({ members });
});

operationsRouter.post(
  '/upload-image',
  requireOperationsPermission('can_manage_inventory'),
  (req, res) => {
    const { data_url, filename } = req.body as { data_url?: string; filename?: string };
    if (!data_url || !data_url.startsWith('data:image/')) {
      res.status(400).json({ error: 'Invalid image payload.' });
      return;
    }

    const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(data_url);
    if (!match) {
      res.status(400).json({ error: 'Supported image formats: JPEG, PNG, WebP.' });
      return;
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'Image size must be under 5 MB.' });
      return;
    }

    const safeBase = (filename || 'product')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 24);
    const outName = `${safeBase}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const outPath = path.join(getUploadsDir(), outName);
    fs.writeFileSync(outPath, buf);

    res.status(201).json({ url: `/uploads/${outName}` });
  }
);

operationsRouter.get(
  '/products',
  requireOperationsPermission('can_manage_inventory'),
  (_req, res) => {
    const products = db
      .prepare(
        `SELECT p.internal_ref AS listing_token,
                p.storage_id,
                p.name,
                p.category,
                p.description,
                p.unit_label,
                p.price,
                p.initial_qty,
                p.available_qty,
                p.sold_qty,
                p.space_per_unit_sqm,
                p.image_url,
                p.gallery_urls,
                p.status,
                p.created_at,
                p.updated_at,
                m.business_name
         FROM product_listings p
         JOIN member_profiles m ON m.id = p.member_id
         ORDER BY CASE p.status WHEN 'Archived' THEN 1 ELSE 0 END, p.created_at DESC`
      )
      .all() as Array<{
      listing_token: string;
      storage_id: string;
      name: string;
      category: string;
      description: string;
      unit_label: string;
      price: number;
      initial_qty: number;
      available_qty: number;
      sold_qty: number;
      space_per_unit_sqm: number;
      image_url: string;
      gallery_urls: string;
      status: string;
      created_at: string;
      updated_at: string;
      business_name: string;
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
  }
);

operationsRouter.post(
  '/products',
  requireOperationsPermission('can_manage_inventory'),
  (req: AuthenticatedRequest, res) => {
    const {
      storage_id,
      name,
      category,
      description,
      unit_label,
      price,
      initial_qty,
      space_per_unit_sqm,
      image_url,
      gallery_urls,
    } = req.body as {
      storage_id?: string;
      name?: string;
      category?: string;
      description?: string;
      unit_label?: string;
      price?: number;
      initial_qty?: number;
      space_per_unit_sqm?: number;
      image_url?: string;
      gallery_urls?: string[];
    };

    if (!storage_id || !name?.trim() || !category?.trim() || !description?.trim()) {
      res.status(400).json({ error: 'Storage ID, product name, category, and description are required.' });
      return;
    }

    const numericPrice = Number(price);
    const qty = Math.floor(Number(initial_qty));
    const unitSpace = Number(space_per_unit_sqm || 0.25);

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      res.status(400).json({ error: 'Price must be greater than zero.' });
      return;
    }
    if (!Number.isFinite(qty) || qty < 0) {
      res.status(400).json({ error: 'Initial quantity must be zero or greater.' });
      return;
    }
    if (!Number.isFinite(unitSpace) || unitSpace <= 0) {
      res.status(400).json({ error: 'Space per unit must be greater than zero.' });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      const created = runInTransaction(() => {
        const member = db
          .prepare(
            `SELECT m.id, m.user_id, m.storage_id, m.allocated_space_sqm, m.occupied_space_sqm
             FROM member_profiles m
             JOIN users u ON u.id = m.user_id
             WHERE m.storage_id = ? AND m.application_status = 'approved' AND u.status = 'active'`
          )
          .get(storage_id.trim().toUpperCase()) as
          | {
              id: number;
              user_id: number;
              storage_id: string;
              allocated_space_sqm: number;
              occupied_space_sqm: number;
            }
          | undefined;

        if (!member) {
          throw new Error(`No active approved member found for Storage ID ${storage_id}.`);
        }

        const primaryImg =
          image_url?.trim() || '/src/assets/images/product_portland_cement_1794824614753.jpg';
        const gallery = Array.isArray(gallery_urls) && gallery_urls.length > 0 ? gallery_urls : [primaryImg];
        const internalRef = generateInternalRef();
        const ts = nowIso();
        const status = qty > 0 ? 'Available' : 'Out of Stock';

        const resInsert = db
          .prepare(
            `INSERT INTO product_listings (
              internal_ref, member_id, storage_id, name, category, description,
              unit_label, price, initial_qty, available_qty, sold_qty,
              space_per_unit_sqm, image_url, gallery_urls, status, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            internalRef,
            member.id,
            member.storage_id,
            name.trim(),
            category.trim(),
            description.trim(),
            (unit_label || 'units').trim(),
            numericPrice,
            qty,
            qty,
            unitSpace,
            primaryImg,
            JSON.stringify(gallery),
            status,
            actor.id,
            ts,
            ts
          );
        const listingId = Number(resInsert.lastInsertRowid);

        const newOccupied = Math.min(
          member.allocated_space_sqm,
          Number((member.occupied_space_sqm + qty * unitSpace).toFixed(2))
        );
        db.prepare('UPDATE member_profiles SET occupied_space_sqm = ? WHERE id = ?').run(
          newOccupied,
          member.id
        );

        db.prepare(
          `INSERT INTO inventory_movements (
            listing_id, member_id, storage_id, movement_type, qty_change,
            qty_before, qty_after, reference, note, performed_by, created_at
          ) VALUES (?, ?, ?, 'initial_registration', ?, 0, ?, 'REG', ?, ?, ?)`
        ).run(
          listingId,
          member.id,
          member.storage_id,
          qty,
          qty,
          `Registered ${name.trim()} (${qty} ${(unit_label || 'units').trim()}) by ${actorLabel}.`,
          actor.id,
          ts
        );

        notifyUser({
          userId: member.user_id,
          category: 'product_registered',
          title: `Product Registered · ${name.trim()}`,
          message: `${actorLabel} registered ${name.trim()} under ${member.storage_id} (${qty} ${(unit_label || 'units').trim()} at ${numericPrice.toLocaleString()} RWF).`,
        });

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: 'register_product',
          targetType: 'product_listing',
          targetRef: member.storage_id,
          details: `${actorLabel} registered ${name.trim()} for ${member.storage_id} (${qty} ${(unit_label || 'units').trim()} at ${numericPrice.toLocaleString()} RWF).`,
        });

        return { listing_token: internalRef, storage_id: member.storage_id };
      });

      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to register product.' });
    }
  }
);

operationsRouter.patch(
  '/products/:token',
  requireOperationsPermission('can_manage_inventory'),
  (req: AuthenticatedRequest, res) => {
    const token = req.params.token;
    const { name, category, description, unit_label, price, image_url, status } = req.body as {
      name?: string;
      category?: string;
      description?: string;
      unit_label?: string;
      price?: number;
      image_url?: string;
      status?: 'Available' | 'Archived';
    };

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      runInTransaction(() => {
        const listing = db
          .prepare(
            `SELECT p.id, p.member_id, p.storage_id, p.name, p.category, p.description,
                    p.unit_label, p.price, p.available_qty, p.image_url, p.status, m.user_id
             FROM product_listings p
             JOIN member_profiles m ON m.id = p.member_id
             WHERE p.internal_ref = ?`
          )
          .get(token) as
          | {
              id: number;
              member_id: number;
              storage_id: string;
              name: string;
              category: string;
              description: string;
              unit_label: string;
              price: number;
              available_qty: number;
              image_url: string;
              status: string;
              user_id: number;
            }
          | undefined;

        if (!listing) {
          throw new Error('Product listing not found.');
        }

        const nextName = name?.trim() || listing.name;
        const nextCat = category?.trim() || listing.category;
        const nextDesc = description?.trim() || listing.description;
        const nextUnit = unit_label?.trim() || listing.unit_label;
        const nextPrice =
          price !== undefined && Number.isFinite(Number(price)) && Number(price) > 0
            ? Number(price)
            : listing.price;
        const nextImg = image_url?.trim() || listing.image_url;
        let nextStatus = listing.status;
        if (status === 'Archived') {
          nextStatus = 'Archived';
        } else if (status === 'Available') {
          nextStatus = listing.available_qty > 0 ? 'Available' : 'Out of Stock';
        }

        const ts = nowIso();
        db.prepare(
          `UPDATE product_listings
           SET name = ?, category = ?, description = ?, unit_label = ?,
               price = ?, image_url = ?, gallery_urls = ?, status = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          nextName,
          nextCat,
          nextDesc,
          nextUnit,
          nextPrice,
          nextImg,
          JSON.stringify([nextImg]),
          nextStatus,
          ts,
          listing.id
        );

        if (status === 'Archived' && listing.status !== 'Archived') {
          db.prepare(
            `INSERT INTO inventory_movements (
              listing_id, member_id, storage_id, movement_type, qty_change,
              qty_before, qty_after, reference, note, performed_by, created_at
            ) VALUES (?, ?, ?, 'archived', 0, ?, ?, 'ARCH', ?, ?, ?)`
          ).run(
            listing.id,
            listing.member_id,
            listing.storage_id,
            listing.available_qty,
            listing.available_qty,
            `Listing archived by ${actorLabel}.`,
            actor.id,
            ts
          );

          notifyUser({
            userId: listing.user_id,
            category: 'product_archived',
            title: `Product Archived · ${nextName}`,
            message: `${actorLabel} archived ${nextName} (${listing.storage_id}). Historical sales records remain preserved.`,
          });
        } else if (status === 'Available' && listing.status === 'Archived') {
          db.prepare(
            `INSERT INTO inventory_movements (
              listing_id, member_id, storage_id, movement_type, qty_change,
              qty_before, qty_after, reference, note, performed_by, created_at
            ) VALUES (?, ?, ?, 'restored', 0, ?, ?, 'REST', ?, ?, ?)`
          ).run(
            listing.id,
            listing.member_id,
            listing.storage_id,
            listing.available_qty,
            listing.available_qty,
            `Listing restored to marketplace by ${actorLabel}.`,
            actor.id,
            ts
          );

          notifyUser({
            userId: listing.user_id,
            category: 'stock_change',
            title: `Product Restored · ${nextName}`,
            message: `${actorLabel} restored ${nextName} (${listing.storage_id}) to the public catalog.`,
          });
        } else if (nextPrice !== listing.price) {
          notifyUser({
            userId: listing.user_id,
            category: 'stock_change',
            title: `Listing Updated · ${nextName}`,
            message: `${actorLabel} updated ${nextName} (${listing.storage_id}) unit price to ${nextPrice.toLocaleString()} RWF.`,
          });
        }

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: status === 'Archived' ? 'archive_product' : 'update_product',
          targetType: 'product_listing',
          targetRef: listing.storage_id,
          details: `${actorLabel} updated listing "${nextName}" for ${listing.storage_id} (status: ${nextStatus}, price: ${nextPrice.toLocaleString()} RWF).`,
        });
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update product.' });
    }
  }
);

operationsRouter.post(
  '/products/:token/adjust-stock',
  requireOperationsPermission('can_manage_inventory'),
  (req: AuthenticatedRequest, res) => {
    const token = req.params.token;
    const { movement_type, qty_change, note } = req.body as {
      movement_type?: 'restock' | 'adjustment';
      qty_change?: number;
      note?: string;
    };

    const delta = Math.trunc(Number(qty_change));
    if (!Number.isFinite(delta) || delta === 0) {
      res.status(400).json({ error: 'Quantity adjustment must be a non-zero integer.' });
      return;
    }
    if (movement_type !== 'restock' && movement_type !== 'adjustment') {
      res.status(400).json({ error: 'Movement type must be restock or adjustment.' });
      return;
    }
    if (movement_type === 'restock' && delta < 0) {
      res.status(400).json({ error: 'Restock quantity must be positive.' });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      const updated = runInTransaction(() => {
        const listing = db
          .prepare(
            `SELECT p.id, p.member_id, p.storage_id, p.name, p.unit_label,
                    p.available_qty, p.space_per_unit_sqm, p.status,
                    m.user_id, m.allocated_space_sqm, m.occupied_space_sqm
             FROM product_listings p
             JOIN member_profiles m ON m.id = p.member_id
             WHERE p.internal_ref = ?`
          )
          .get(token) as
          | {
              id: number;
              member_id: number;
              storage_id: string;
              name: string;
              unit_label: string;
              available_qty: number;
              space_per_unit_sqm: number;
              status: string;
              user_id: number;
              allocated_space_sqm: number;
              occupied_space_sqm: number;
            }
          | undefined;

        if (!listing) {
          throw new Error('Product listing not found.');
        }

        const newQty = listing.available_qty + delta;
        if (newQty < 0) {
          throw new Error(`Stock cannot drop below zero (current: ${listing.available_qty}).`);
        }

        const nextStatus =
          listing.status === 'Archived' ? 'Archived' : newQty > 0 ? 'Available' : 'Out of Stock';
        const ts = nowIso();

        db.prepare(
          'UPDATE product_listings SET available_qty = ?, status = ?, updated_at = ? WHERE id = ?'
        ).run(newQty, nextStatus, ts, listing.id);

        const nextOccupied = Math.max(
          0,
          Math.min(
            listing.allocated_space_sqm,
            Number((listing.occupied_space_sqm + delta * listing.space_per_unit_sqm).toFixed(2))
          )
        );
        db.prepare('UPDATE member_profiles SET occupied_space_sqm = ? WHERE id = ?').run(
          nextOccupied,
          listing.member_id
        );

        db.prepare(
          `INSERT INTO inventory_movements (
            listing_id, member_id, storage_id, movement_type, qty_change,
            qty_before, qty_after, reference, note, performed_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          listing.id,
          listing.member_id,
          listing.storage_id,
          movement_type,
          delta,
          listing.available_qty,
          newQty,
          movement_type === 'restock' ? 'RSTK' : 'ADJ',
          (note || `${movement_type} of ${delta > 0 ? `+${delta}` : delta} ${listing.unit_label}`).trim(),
          actor.id,
          ts
        );

        notifyUser({
          userId: listing.user_id,
          category: 'stock_change',
          title: `Stock Updated · ${listing.name}`,
          message: `${listing.name} (${listing.storage_id}) stock changed from ${listing.available_qty} to ${newQty} ${listing.unit_label}.`,
        });

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: movement_type === 'restock' ? 'restock_inventory' : 'adjust_inventory',
          targetType: 'product_listing',
          targetRef: listing.storage_id,
          details: `${actorLabel} recorded ${movement_type} (${delta > 0 ? `+${delta}` : delta}) on ${listing.name} for ${listing.storage_id}.`,
        });

        return { available_qty: newQty, status: nextStatus };
      });

      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Stock adjustment failed.' });
    }
  }
);

operationsRouter.get(
  '/inventory-movements',
  requireOperationsPermission('can_manage_inventory'),
  (_req, res) => {
    const movements = db
      .prepare(
        `SELECT im.id, im.storage_id, im.movement_type, im.qty_change,
                im.qty_before, im.qty_after, im.reference, im.note, im.created_at,
                p.name AS product_name, p.unit_label,
                COALESCE(sp.staff_code, u.full_name, 'System') AS actor_name
         FROM inventory_movements im
         JOIN product_listings p ON p.id = im.listing_id
         LEFT JOIN users u ON u.id = im.performed_by
         LEFT JOIN staff_permissions sp ON sp.user_id = u.id
         ORDER BY im.created_at DESC LIMIT 120`
      )
      .all();

    res.json({ movements });
  }
);

// ========================
// ORDERS & FULFILLMENT
// ========================

operationsRouter.get(
  '/orders/stream',
  requireOperationsPermission('can_manage_orders'),
  (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const unsubscribe = subscribeOrderUpdates((payload) => {
      res.write(`event: order_update\ndata: ${JSON.stringify(payload)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }
);

operationsRouter.get(
  '/orders',
  requireOperationsPermission('can_manage_orders'),
  (_req, res) => {
    const orders = db
      .prepare(
        `SELECT id, order_reference, customer_name, customer_phone,
                fulfillment_method, delivery_address, delivery_fee,
                subtotal_amount, total_amount, status, sale_processed,
                customer_confirmed_received, customer_confirmed_at,
                completed_at, created_at, updated_at
         FROM orders
         ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: number;
      order_reference: string;
      customer_name: string;
      customer_phone: string;
      fulfillment_method: string;
      delivery_address: string;
      delivery_fee: number;
      subtotal_amount: number;
      total_amount: number;
      status: string;
      sale_processed: number;
      customer_confirmed_received: number;
      customer_confirmed_at: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const itemStmt = db.prepare(
      `SELECT storage_id, product_name, unit_label, unit_price, quantity, subtotal
       FROM order_items WHERE order_id = ?`
    );

    const enriched = orders.map((o) => ({
      ...o,
      items: itemStmt.all(o.id),
    }));

    res.json({ orders: enriched });
  }
);

const ALLOWED_ORDER_STATUSES = [
  'Pending Confirmation',
  'Confirmed',
  'Ready for Collection',
  'Out for Delivery',
  'Completed',
  'Cancelled',
] as const;

operationsRouter.patch(
  '/orders/:orderRef/status',
  requireOperationsPermission('can_manage_orders'),
  (req: AuthenticatedRequest, res) => {
    const orderRef = req.params.orderRef.trim().toUpperCase();
    const { status } = req.body as { status?: (typeof ALLOWED_ORDER_STATUSES)[number] };

    if (!status || !ALLOWED_ORDER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Invalid order status.' });
      return;
    }

    const actor = req.authUser!;
    const actorLabel = getActorLabel(actor);

    try {
      const result = runInTransaction(() => {
        const order = db
          .prepare(
            `SELECT id, order_reference, status, sale_processed, total_amount
             FROM orders WHERE UPPER(order_reference) = ?`
          )
          .get(orderRef) as
          | {
              id: number;
              order_reference: string;
              status: string;
              sale_processed: number;
              total_amount: number;
            }
          | undefined;

        if (!order) {
          throw new Error('Order not found.');
        }
        if (order.status === 'Completed' || order.sale_processed === 1) {
          throw new Error('Order is already Completed and processed; duplicate processing is blocked.');
        }
        if (order.status === 'Cancelled') {
          throw new Error('Cancelled orders cannot be reopened.');
        }

        const ts = nowIso();

        if (status !== 'Completed') {
          db.prepare(
            'UPDATE orders SET status = ?, processed_by = ?, updated_at = ? WHERE id = ?'
          ).run(status, actor.id, ts, order.id);

          recordAuditLog({
            actorUserId: actor.id,
            actorLabel,
            actorRole: actor.role,
            action: 'update_order_status',
            targetType: 'order',
            targetRef: order.order_reference,
            details: `${actorLabel} updated order ${order.order_reference} status to "${status}".`,
          });

          return { order_reference: order.order_reference, status, sale_processed: 0 };
        }

        // Transitioning to COMPLETED: Atomic stock deduction + sales transaction + member notification
        const items = db
          .prepare(
            `SELECT oi.id AS order_item_id, oi.listing_id, oi.member_id, oi.storage_id,
                    oi.product_name, oi.unit_label, oi.unit_price, oi.quantity, oi.subtotal
             FROM order_items oi WHERE oi.order_id = ?`
          )
          .all(order.id) as Array<{
          order_item_id: number;
          listing_id: number;
          member_id: number;
          storage_id: string;
          product_name: string;
          unit_label: string;
          unit_price: number;
          quantity: number;
          subtotal: number;
        }>;

        if (items.length === 0) {
          throw new Error('Order has no line items.');
        }

        const memberSalesSummary = new Map<
          number,
          { userId: number; storageId: string; lines: string[]; total: number }
        >();

        for (const item of items) {
          const listing = db
            .prepare(
              `SELECT p.id, p.available_qty, p.sold_qty, p.space_per_unit_sqm, p.status,
                      m.user_id, m.occupied_space_sqm
               FROM product_listings p
               JOIN member_profiles m ON m.id = p.member_id
               WHERE p.id = ?`
            )
            .get(item.listing_id) as
            | {
                id: number;
                available_qty: number;
                sold_qty: number;
                space_per_unit_sqm: number;
                status: string;
                user_id: number;
                occupied_space_sqm: number;
              }
            | undefined;

          if (!listing) {
            throw new Error(`Product listing for ${item.product_name} no longer exists.`);
          }
          if (listing.available_qty < item.quantity) {
            throw new Error(
              `Insufficient remaining stock for ${item.product_name} (${item.storage_id}). Available: ${listing.available_qty}, Ordered: ${item.quantity}.`
            );
          }

          const newAvailable = listing.available_qty - item.quantity;
          const newSold = listing.sold_qty + item.quantity;
          const nextListingStatus =
            listing.status === 'Archived'
              ? 'Archived'
              : newAvailable > 0
                ? 'Available'
                : 'Out of Stock';

          db.prepare(
            `UPDATE product_listings
             SET available_qty = ?, sold_qty = ?, status = ?, updated_at = ?
             WHERE id = ?`
          ).run(newAvailable, newSold, nextListingStatus, ts, listing.id);

          const nextOccupied = Math.max(
            0,
            Number((listing.occupied_space_sqm - item.quantity * listing.space_per_unit_sqm).toFixed(2))
          );
          db.prepare('UPDATE member_profiles SET occupied_space_sqm = ? WHERE id = ?').run(
            nextOccupied,
            item.member_id
          );

          // UNIQUE(order_item_id) constraint guarantees no duplicate sale recording
          db.prepare(
            `INSERT INTO sales_transactions (
              order_id, order_item_id, order_reference, listing_id, member_id,
              storage_id, product_name, quantity_sold, unit_price, total_amount,
              confirmed_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            order.id,
            item.order_item_id,
            order.order_reference,
            item.listing_id,
            item.member_id,
            item.storage_id,
            item.product_name,
            item.quantity,
            item.unit_price,
            item.subtotal,
            actor.id,
            ts
          );

          db.prepare(
            `INSERT INTO inventory_movements (
              listing_id, member_id, storage_id, movement_type, qty_change,
              qty_before, qty_after, reference, note, performed_by, created_at
            ) VALUES (?, ?, ?, 'sale_completed', ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            item.listing_id,
            item.member_id,
            item.storage_id,
            -item.quantity,
            listing.available_qty,
            newAvailable,
            order.order_reference,
            `Completed order ${order.order_reference} confirmed by ${actorLabel}.`,
            actor.id,
            ts
          );

          const entry = memberSalesSummary.get(item.member_id) || {
            userId: listing.user_id,
            storageId: item.storage_id,
            lines: [],
            total: 0,
          };
          entry.lines.push(`${item.quantity} ${item.unit_label} of ${item.product_name}`);
          entry.total += item.subtotal;
          memberSalesSummary.set(item.member_id, entry);
        }

        db.prepare(
          `UPDATE orders
           SET status = 'Completed', sale_processed = 1, processed_by = ?,
               completed_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(actor.id, ts, ts, order.id);

        for (const summary of memberSalesSummary.values()) {
          notifyUser({
            userId: summary.userId,
            category: 'sale_completed',
            title: `Sale Completed · ${order.order_reference}`,
            message: `${summary.lines.join(', ')} sold from ${summary.storageId} for ${summary.total.toLocaleString()} RWF.`,
          });
        }

        recordAuditLog({
          actorUserId: actor.id,
          actorLabel,
          actorRole: actor.role,
          action: 'complete_order',
          targetType: 'order',
          targetRef: order.order_reference,
          details: `${actorLabel} confirmed completed customer order ${order.order_reference} (${order.total_amount.toLocaleString()} RWF).`,
        });

        return { order_reference: order.order_reference, status: 'Completed', sale_processed: 1 };
      });

      emitOrderUpdate(result.order_reference, 'status_changed');
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update order status.';
      const code = msg.includes('already Completed') || msg.includes('cannot be reopened') ? 409 : 400;
      res.status(code).json({ error: msg });
    }
  }
);

// ========================
// MEMBER ASSISTANCE & REPORTS
// ========================

operationsRouter.get(
  '/members',
  requireOperationsPermission('can_assist_members'),
  (_req, res) => {
    const members = db
      .prepare(
        `SELECT m.id, m.storage_id, m.business_name, m.application_status,
                m.allocated_space_sqm, m.occupied_space_sqm, m.monthly_rental_fee,
                u.full_name, u.email, u.phone, u.status AS user_status,
                (SELECT COUNT(*) FROM product_listings p WHERE p.member_id = m.id AND p.status != 'Archived') AS active_products
         FROM member_profiles m
         JOIN users u ON u.id = m.user_id
         WHERE m.application_status = 'approved'
         ORDER BY m.storage_id ASC`
      )
      .all();

    res.json({ members });
  }
);

operationsRouter.get(
  '/reports',
  requireOperationsPermission('can_view_reports'),
  (req, res) => {
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

    const salesSummary = db
      .prepare(
        `SELECT COUNT(*) AS transaction_count,
                COALESCE(SUM(s.quantity_sold), 0) AS units_sold,
                COALESCE(SUM(s.total_amount), 0) AS total_revenue
         FROM sales_transactions s
         WHERE 1=1 ${dateClause}`
      )
      .get(...params);

    const byStorage = db
      .prepare(
        `SELECT s.storage_id,
                SUM(s.quantity_sold) AS units_sold,
                SUM(s.total_amount) AS revenue,
                COUNT(*) AS transactions
         FROM sales_transactions s
         WHERE 1=1 ${dateClause}
         GROUP BY s.storage_id
         ORDER BY revenue DESC`
      )
      .all(...params);

    const orderBreakdown = db
      .prepare(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS value
         FROM orders
         GROUP BY status`
      )
      .all();

    const storageUtilization = db
      .prepare(
        `SELECT COALESCE(SUM(allocated_space_sqm), 0) AS total_allocated,
                COALESCE(SUM(occupied_space_sqm), 0) AS total_occupied,
                COUNT(*) AS approved_members
         FROM member_profiles
         WHERE application_status = 'approved'`
      )
      .get();

    res.json({
      sales_summary: salesSummary,
      by_storage: byStorage,
      order_breakdown: orderBreakdown,
      storage_utilization: storageUtilization,
    });
  }
);
