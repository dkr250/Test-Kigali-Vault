import crypto from 'node:crypto';
import { Router } from 'express';
import { recordAuditLog } from '../auth.ts';
import { db, nowIso, runInTransaction } from '../db.ts';
import { emitOrderUpdate } from '../orderEvents.ts';

export const publicRouter = Router();

function getSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM system_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, '').trim();
}

publicRouter.get('/settings', (_req, res) => {
  const s = getSettingsMap();
  res.json({
    warehouse_name: s.warehouse_name || 'Kigali Vault',
    currency_code: s.currency_code || 'RWF',
    base_rate_per_sqm: Number(s.base_rate_per_sqm || 1500),
    delivery_fee: Number(s.delivery_fee || 5000),
    free_delivery_threshold: Number(s.free_delivery_threshold || 250000),
    warehouse_address: s.warehouse_address || '',
    support_phone: s.support_phone || '',
    allow_guest_checkout: s.allow_guest_checkout !== 'false',
  });
});

publicRouter.get('/categories', (_req, res) => {
  const categories = db
    .prepare('SELECT id, name, sort_order FROM product_categories ORDER BY sort_order ASC, name ASC')
    .all();
  res.json({ categories });
});

publicRouter.get('/slides', (_req, res) => {
  const s = getSettingsMap();
  const slides = db
    .prepare(
      `SELECT id, media_url, media_type, headline, location_text, dispatch_text, sort_order
       FROM hero_slides
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    )
    .all();

  res.json({
    slides,
    autoplay: s.hero_autoplay !== 'false',
    interval_ms: Math.max(2000, Number(s.hero_slide_interval_ms || 5500)),
  });
});

publicRouter.get('/popup-banners', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, is_enabled, image_url, headline, description, cta_label,
              text_position, text_align, text_order, overlay_style, text_color,
              trigger_type, trigger_delay_seconds, trigger_scroll_percent,
              trigger_click_threshold, trigger_interaction_target, display_frequency,
              sort_order, created_at, updated_at
       FROM popup_banners
       WHERE is_enabled = 1 AND trim(image_url) != ''
       ORDER BY sort_order ASC, id ASC`
    )
    .all() as Array<Record<string, unknown>>;

  res.json({
    popups: rows.map((r) => ({ ...r, is_enabled: r.is_enabled === 1 })),
  });
});

publicRouter.get('/popup-banner', (_req, res) => {
  const row = db
    .prepare(
      `SELECT id, title, is_enabled, image_url, headline, description, cta_label,
              text_position, text_align, text_order, overlay_style, text_color,
              trigger_type, trigger_delay_seconds, trigger_scroll_percent,
              trigger_click_threshold, trigger_interaction_target, display_frequency,
              sort_order, updated_at
       FROM popup_banners
       WHERE is_enabled = 1 AND trim(image_url) != ''
       ORDER BY sort_order ASC, id ASC
       LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;

  res.json({
    popup: row
      ? { ...row, is_enabled: row.is_enabled === 1 }
      : {
          is_enabled: false,
          image_url: '',
          headline: '',
          description: '',
          cta_label: 'Explore Catalog',
          text_position: 'bottom',
          text_align: 'left',
          text_order: 'headline_first',
          overlay_style: 'dark_scrim',
          text_color: 'white',
          trigger_type: 'first_visit',
          trigger_delay_seconds: 3,
          trigger_scroll_percent: 40,
          trigger_click_threshold: 3,
          trigger_interaction_target: 'any',
          display_frequency: 'once_ever',
          updated_at: '',
        },
  });
});

publicRouter.get('/listings', (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const inStockOnly = req.query.in_stock === 'true';

  // Public query intentionally excludes all member PII (no member_id, full_name, business_name, email, phone)
  const rows = db
    .prepare(
      `SELECT p.internal_ref AS listing_token,
              p.storage_id,
              p.name,
              p.category,
              p.description,
              p.unit_label,
              p.price,
              p.available_qty,
              p.image_url,
              p.gallery_urls,
              p.status,
              p.created_at
       FROM product_listings p
       JOIN member_profiles m ON m.id = p.member_id
       JOIN users u ON u.id = m.user_id
       WHERE p.status != 'Archived'
         AND m.application_status = 'approved'
         AND u.status = 'active'
       ORDER BY p.created_at DESC`
    )
    .all() as Array<{
    listing_token: string;
    storage_id: string;
    name: string;
    category: string;
    description: string;
    unit_label: string;
    price: number;
    available_qty: number;
    image_url: string;
    gallery_urls: string;
    status: string;
    created_at: string;
  }>;

  const filtered = rows
    .filter((r) => {
      if (category && category !== 'All' && r.category !== category) return false;
      if (inStockOnly && r.available_qty <= 0) return false;
      if (search) {
        const hay = `${r.name} ${r.category} ${r.description} ${r.storage_id}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .map((r) => ({
      ...r,
      gallery_urls: (() => {
        try {
          return JSON.parse(r.gallery_urls) as string[];
        } catch {
          return [r.image_url];
        }
      })(),
    }));

  res.json({ listings: filtered });
});

publicRouter.post('/orders', (req, res) => {
  const {
    customer_name,
    customer_phone,
    fulfillment_method,
    delivery_address,
    items,
  } = req.body as {
    customer_name?: string;
    customer_phone?: string;
    fulfillment_method?: 'warehouse_collection' | 'delivery';
    delivery_address?: string;
    items?: Array<{ listing_token: string; quantity: number }>;
  };

  if (!customer_name || !customer_name.trim()) {
    res.status(400).json({ error: 'Customer full name is required.' });
    return;
  }
  if (!customer_phone || normalizePhone(customer_phone).length < 7) {
    res.status(400).json({ error: 'A valid phone number is required.' });
    return;
  }
  if (fulfillment_method !== 'warehouse_collection' && fulfillment_method !== 'delivery') {
    res.status(400).json({ error: 'Select warehouse collection or delivery.' });
    return;
  }
  if (fulfillment_method === 'delivery' && (!delivery_address || !delivery_address.trim())) {
    res.status(400).json({ error: 'Delivery address is required for delivery orders.' });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Your cart is empty.' });
    return;
  }

  const settings = getSettingsMap();
  if (settings.allow_guest_checkout === 'false') {
    res.status(403).json({ error: 'Guest checkout is currently paused by system settings.' });
    return;
  }

  try {
    const result = runInTransaction(() => {
      const mergedQuantities = new Map<string, number>();
      for (const item of items) {
        const qty = Math.floor(Number(item.quantity));
        if (!item.listing_token || !Number.isFinite(qty) || qty <= 0) {
          throw new Error('Invalid cart item quantity.');
        }
        mergedQuantities.set(
          item.listing_token,
          (mergedQuantities.get(item.listing_token) || 0) + qty
        );
      }

      const resolvedItems: Array<{
        listingId: number;
        memberId: number;
        storageId: string;
        productName: string;
        unitLabel: string;
        unitPrice: number;
        quantity: number;
        subtotal: number;
      }> = [];

      let subtotalAmount = 0;

      for (const [token, qty] of mergedQuantities.entries()) {
        const listing = db
          .prepare(
            `SELECT p.id, p.member_id, p.storage_id, p.name, p.unit_label, p.price, p.available_qty, p.status
             FROM product_listings p
             JOIN member_profiles m ON m.id = p.member_id
             WHERE p.internal_ref = ? AND m.application_status = 'approved'`
          )
          .get(token) as
          | {
              id: number;
              member_id: number;
              storage_id: string;
              name: string;
              unit_label: string;
              price: number;
              available_qty: number;
              status: string;
            }
          | undefined;

        if (!listing || listing.status === 'Archived') {
          throw new Error('One of the requested products is no longer available.');
        }
        if (listing.available_qty < qty) {
          throw new Error(
            `Insufficient stock for ${listing.name} (${listing.storage_id}). Only ${listing.available_qty} ${listing.unit_label} available.`
          );
        }

        const lineSubtotal = listing.price * qty;
        subtotalAmount += lineSubtotal;
        resolvedItems.push({
          listingId: listing.id,
          memberId: listing.member_id,
          storageId: listing.storage_id,
          productName: listing.name,
          unitLabel: listing.unit_label,
          unitPrice: listing.price,
          quantity: qty,
          subtotal: lineSubtotal,
        });
      }

      const baseDeliveryFee = Number(settings.delivery_fee || 5000);
      const freeThreshold = Number(settings.free_delivery_threshold || 250000);
      const deliveryFee =
        fulfillment_method === 'delivery' && subtotalAmount < freeThreshold ? baseDeliveryFee : 0;
      const totalAmount = subtotalAmount + deliveryFee;

      const year = new Date().getUTCFullYear();
      let orderReference = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = crypto.randomInt(1000, 9999);
        const candidate = `ORD-${year}-${suffix}`;
        const exists = db
          .prepare('SELECT id FROM orders WHERE order_reference = ?')
          .get(candidate);
        if (!exists) {
          orderReference = candidate;
          break;
        }
      }
      if (!orderReference) {
        orderReference = `ORD-${year}-${Date.now().toString().slice(-6)}`;
      }

      const ts = nowIso();
      const orderRes = db
        .prepare(
          `INSERT INTO orders (
            order_reference, customer_name, customer_phone, fulfillment_method,
            delivery_address, delivery_fee, subtotal_amount, total_amount,
            status, sale_processed, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending Confirmation', 0, ?, ?)`
        )
        .run(
          orderReference,
          customer_name.trim(),
          customer_phone.trim(),
          fulfillment_method,
          fulfillment_method === 'delivery' ? (delivery_address || '').trim() : '',
          deliveryFee,
          subtotalAmount,
          totalAmount,
          ts,
          ts
        );
      const orderId = Number(orderRes.lastInsertRowid);

      const insertItem = db.prepare(
        `INSERT INTO order_items (
          order_id, listing_id, member_id, storage_id, product_name,
          unit_label, unit_price, quantity, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of resolvedItems) {
        insertItem.run(
          orderId,
          item.listingId,
          item.memberId,
          item.storageId,
          item.productName,
          item.unitLabel,
          item.unitPrice,
          item.quantity,
          item.subtotal
        );
      }

      recordAuditLog({
        actorUserId: null,
        actorLabel: 'Guest Checkout',
        actorRole: 'public',
        action: 'place_order',
        targetType: 'order',
        targetRef: orderReference,
        details: `Guest customer placed order ${orderReference} (${resolvedItems.length} item line(s), total ${totalAmount} ${settings.currency_code || 'RWF'}).`,
      });

      return {
        order_reference: orderReference,
        customer_name: customer_name.trim(),
        status: 'Pending Confirmation',
        fulfillment_method,
        delivery_address: fulfillment_method === 'delivery' ? (delivery_address || '').trim() : '',
        subtotal_amount: subtotalAmount,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
        customer_confirmed_received: 0,
        customer_confirmed_at: null,
        created_at: ts,
        items: resolvedItems.map((i) => ({
          storage_id: i.storageId,
          product_name: i.productName,
          unit_label: i.unitLabel,
          unit_price: i.unitPrice,
          quantity: i.quantity,
          subtotal: i.subtotal,
        })),
      };
    });

    emitOrderUpdate(result.order_reference, 'created');
    res.status(201).json({ order: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to place order.';
    res.status(400).json({ error: message });
  }
});

publicRouter.post('/orders/track', (req, res) => {
  const { order_reference, customer_phone } = req.body as {
    order_reference?: string;
    customer_phone?: string;
  };

  if (!order_reference || !customer_phone) {
    res.status(400).json({ error: 'Both Order Reference and Phone Number are required.' });
    return;
  }

  const ref = order_reference.trim().toUpperCase();
  const phoneNorm = normalizePhone(customer_phone);

  const order = db
    .prepare(
      `SELECT id, order_reference, customer_name, customer_phone, fulfillment_method,
              delivery_address, delivery_fee, subtotal_amount, total_amount, status,
              customer_confirmed_received, customer_confirmed_at,
              completed_at, created_at, updated_at
       FROM orders WHERE UPPER(order_reference) = ?`
    )
    .get(ref) as
    | {
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
        customer_confirmed_received: number;
        customer_confirmed_at: string | null;
        completed_at: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!order || normalizePhone(order.customer_phone) !== phoneNorm) {
    res.status(404).json({
      error: 'No matching order found. Please verify both your Order Reference and Phone Number.',
    });
    return;
  }

  const items = db
    .prepare(
      `SELECT storage_id, product_name, unit_label, unit_price, quantity, subtotal
       FROM order_items WHERE order_id = ?`
    )
    .all(order.id);

  res.json({
    order: {
      order_reference: order.order_reference,
      customer_name: order.customer_name,
      fulfillment_method: order.fulfillment_method,
      delivery_address: order.delivery_address,
      delivery_fee: order.delivery_fee,
      subtotal_amount: order.subtotal_amount,
      total_amount: order.total_amount,
      status: order.status,
      customer_confirmed_received: order.customer_confirmed_received,
      customer_confirmed_at: order.customer_confirmed_at,
      completed_at: order.completed_at,
      created_at: order.created_at,
      updated_at: order.updated_at,
      items,
    },
  });
});

publicRouter.post('/orders/:orderRef/confirm-received', (req, res) => {
  const ref = String(req.params.orderRef || '').trim().toUpperCase();
  const { customer_phone } = req.body as { customer_phone?: string };

  if (!ref || !customer_phone) {
    res.status(400).json({ error: 'Order Reference and Phone Number are required to confirm receipt.' });
    return;
  }

  const phoneNorm = normalizePhone(customer_phone);

  try {
    const updatedOrder = runInTransaction(() => {
      const order = db
        .prepare(
          `SELECT id, order_reference, customer_name, customer_phone, fulfillment_method,
                  delivery_address, delivery_fee, subtotal_amount, total_amount, status,
                  customer_confirmed_received, customer_confirmed_at,
                  completed_at, created_at, updated_at
           FROM orders WHERE UPPER(order_reference) = ?`
        )
        .get(ref) as
        | {
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
            customer_confirmed_received: number;
            customer_confirmed_at: string | null;
            completed_at: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (!order || normalizePhone(order.customer_phone) !== phoneNorm) {
        throw new Error('No matching order found for that reference and phone number.');
      }
      if (order.status === 'Cancelled') {
        throw new Error('Cancelled orders cannot be confirmed as received.');
      }

      const ts = nowIso();
      let confirmedAt = order.customer_confirmed_at;
      if (order.customer_confirmed_received !== 1) {
        confirmedAt = ts;
        db.prepare(
          `UPDATE orders
           SET customer_confirmed_received = 1, customer_confirmed_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(confirmedAt, ts, order.id);

        recordAuditLog({
          actorUserId: null,
          actorLabel: 'Guest Customer',
          actorRole: 'public',
          action: 'customer_confirm_received',
          targetType: 'order',
          targetRef: order.order_reference,
          details: `Customer confirmed receipt ("Received") for order ${order.order_reference}; ready for staff completion.`,
        });
      }

      const items = db
        .prepare(
          `SELECT storage_id, product_name, unit_label, unit_price, quantity, subtotal
           FROM order_items WHERE order_id = ?`
        )
        .all(order.id);

      return {
        order_reference: order.order_reference,
        customer_name: order.customer_name,
        fulfillment_method: order.fulfillment_method,
        delivery_address: order.delivery_address,
        delivery_fee: order.delivery_fee,
        subtotal_amount: order.subtotal_amount,
        total_amount: order.total_amount,
        status: order.status,
        customer_confirmed_received: 1,
        customer_confirmed_at: confirmedAt,
        completed_at: order.completed_at,
        created_at: order.created_at,
        updated_at: ts,
        items,
      };
    });

    emitOrderUpdate(updatedOrder.order_reference, 'customer_received');
    res.json({ order: updatedOrder });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to confirm receipt.' });
  }
});
