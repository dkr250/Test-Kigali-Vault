import {
  BarChart3,
  Bell,
  Box,
  Check,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Store,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch, formatDateShort, formatDateTime, formatMoney } from '../lib/api.ts';
import type { AuthUser, MemberNotification, MemberProduct } from '../types.ts';
import { BrandLogo } from './BrandLogo.tsx';
import { ProductImage } from './ProductImage.tsx';
import { StatusText } from './StatusText.tsx';

interface MemberPortalProps {
  authUser: AuthUser;
  onGoToMarketplace: () => void;
  onLogout: () => void;
}

type MemberSection =
  | 'dashboard'
  | 'storage'
  | 'products'
  | 'sales'
  | 'notifications'
  | 'reports';

interface DashboardData {
  storage: {
    storage_id: string;
    business_name: string;
    allocated_space_sqm: number;
    occupied_space_sqm: number;
    remaining_capacity_sqm: number;
    monthly_rental_fee: number;
  };
  product_summary: {
    total_listings: number;
    active_listings: number;
    remaining_units: number;
    sold_units: number;
  };
  sales_summary: {
    completed_transactions: number;
    total_units_sold: number;
    total_revenue: number;
  };
  unread_notifications: number;
  recent_notifications: MemberNotification[];
  recent_sales: Array<{
    order_reference: string;
    product_name: string;
    quantity_sold: number;
    unit_price: number;
    total_amount: number;
    created_at: string;
    order_status: string;
  }>;
}

interface StorageData {
  storage: {
    storage_id: string;
    business_name: string;
    allocated_space_sqm: number;
    occupied_space_sqm: number;
    remaining_capacity_sqm: number;
    monthly_rental_fee: number;
    base_rate_per_sqm: number;
  };
  history: Array<{
    change_type: string;
    previous_space_sqm: number;
    new_space_sqm: number;
    previous_fee: number;
    new_fee: number;
    note: string;
    created_at: string;
  }>;
  requests: Array<{
    id: number;
    requested_extra_sqm: number;
    proposed_fee_increase: number;
    reason: string;
    status: string;
    staff_note: string;
    reviewed_at: string | null;
    created_at: string;
  }>;
}

export function MemberPortal({ authUser, onGoToMarketplace, onLogout }: MemberPortalProps) {
  const [section, setSection] = useState<MemberSection>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [appStatus, setAppStatus] = useState<{
    business_name: string;
    storage_id: string | null;
    application_status: string;
    requested_space_sqm: number;
    rejection_reason: string;
    created_at: string;
  } | null>(null);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [storageData, setStorageData] = useState<StorageData | null>(null);
  const [products, setProducts] = useState<MemberProduct[]>([]);
  const [sales, setSales] = useState<
    Array<{
      product_name: string;
      quantity_sold: number;
      unit_label: string;
      unit_price: number;
      total_amount: number;
      order_reference: string;
      order_status: string;
      sale_date: string;
    }>
  >([]);
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Additional storage request form
  const [extraSqm, setExtraSqm] = useState('25');
  const [extraReason, setExtraReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqMessage, setReqMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Reports filter
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportData, setReportData] = useState<{
    summary: { total_transactions: number; total_units_sold: number; total_revenue: number };
    by_product: Array<{ product_name: string; units_sold: number; revenue: number; sale_count: number }>;
  } | null>(null);

  const [loading, setLoading] = useState(true);

  const isApproved = authUser.status === 'active' && authUser.application_status === 'approved';

  const loadAll = async () => {
    setLoading(true);
    try {
      if (!isApproved) {
        const res = await apiFetch<{ application: typeof appStatus }>(
          '/api/member/application-status'
        );
        setAppStatus(res.application);
        setLoading(false);
        return;
      }

      const [dashRes, storRes, prodRes, salesRes, notifRes] = await Promise.all([
        apiFetch<DashboardData>('/api/member/dashboard'),
        apiFetch<StorageData>('/api/member/storage'),
        apiFetch<{ products: MemberProduct[] }>('/api/member/products'),
        apiFetch<{ sales: typeof sales }>('/api/member/sales'),
        apiFetch<{ notifications: MemberNotification[]; unread_count: number }>(
          '/api/member/notifications'
        ),
      ]);

      setDashboard(dashRes);
      setStorageData(storRes);
      setProducts(prodRes.products);
      setSales(salesRes.sales);
      setNotifications(notifRes.notifications);
      setUnreadCount(notifRes.unread_count);
    } catch {
      // Handled gracefully
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async (from = reportFrom, to = reportTo) => {
    if (!isApproved) return;
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    try {
      const res = await apiFetch<typeof reportData>(`/api/member/reports?${qs.toString()}`);
      setReportData(res);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void loadAll();
  }, [authUser.id, isApproved]);

  useEffect(() => {
    if (section === 'reports') {
      void loadReports();
    }
  }, [section]);

  const handleRequestStorage = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqMessage(null);
    setReqSubmitting(true);
    try {
      await apiFetch('/api/member/storage-requests', {
        method: 'POST',
        body: JSON.stringify({
          requested_extra_sqm: Number(extraSqm),
          reason: extraReason,
        }),
      });
      setExtraReason('');
      setReqMessage({
        type: 'ok',
        text: 'Additional storage request submitted. Authorized staff will review your request.',
      });
      await loadAll();
    } catch (err) {
      setReqMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to submit request.',
      });
    } finally {
      setReqSubmitting(false);
    }
  };

  const markNotificationsRead = async (notificationId?: number) => {
    await apiFetch('/api/member/notifications/read', {
      method: 'POST',
      body: JSON.stringify(notificationId ? { notification_id: notificationId } : {}),
    });
    const notifRes = await apiFetch<{
      notifications: MemberNotification[];
      unread_count: number;
    }>('/api/member/notifications');
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unread_count);
  };

  // Pending / Rejected Applicant View
  if (!isApproved) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 h-16 flex items-center justify-between">
          <BrandLogo variant="light" />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onGoToMarketplace}
              className="text-sm font-medium text-slate-600 hover:text-[#0B1F3A] cursor-pointer"
            >
              Public Marketplace
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-3.5 py-2 text-xs font-semibold border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8 space-y-5">
            <div>
              <p className="text-xs font-medium text-[#9E7220] mb-1">Member Storage Application</p>
              <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                {appStatus?.business_name || authUser.full_name}
              </h1>
            </div>
            <div className="border-t border-b border-slate-200 py-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Application Status</span>
                <StatusText status={appStatus?.application_status || authUser.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Requested Capacity</span>
                <span className="font-mono tabular-nums font-medium">
                  {appStatus?.requested_space_sqm ?? '—'} sqm
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Submitted</span>
                <span className="font-mono text-xs text-slate-600">
                  {formatDateTime(appStatus?.created_at)}
                </span>
              </div>
            </div>
            {appStatus?.application_status === 'rejected' ? (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                <div className="font-semibold mb-1">Review Note</div>
                <div>{appStatus.rejection_reason || 'Application was not approved.'}</div>
              </div>
            ) : (
              <p className="text-sm text-slate-600 leading-relaxed">
                Your warehouse storage request is queued for staff review. Once approved, one permanent unique Storage ID (e.g. WH-0005) will be generated for your account and your Member Portal will unlock automatically.
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  const navItems: Array<{ id: MemberSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'storage', label: 'Storage & Requests', icon: Warehouse },
    { id: 'products', label: 'My Products', icon: Box },
    { id: 'sales', label: 'Sales History', icon: ReceiptText },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
  ];

  const storagePct = dashboard
    ? Math.min(
        100,
        Math.round(
          (dashboard.storage.occupied_space_sqm /
            Math.max(1, dashboard.storage.allocated_space_sqm)) *
            100
        )
      )
    : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0B1F3A] text-white shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-white/10">
          <BrandLogo variant="dark" />
        </div>

        <div className="px-6 py-4 border-b border-white/10">
          <div className="text-xs text-slate-400">Permanent Storage ID</div>
          <div className="font-mono text-lg font-bold text-[#C99E44] mt-0.5">
            {authUser.storage_id}
          </div>
          <div className="text-xs text-slate-300 truncate mt-0.5">{authUser.full_name}</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-white/12 text-white'
                    : 'text-slate-300 hover:bg-white/6 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <Icon className={`w-4 h-4 ${active ? 'text-[#C99E44]' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className="font-mono text-xs text-[#C99E44] tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={onGoToMarketplace}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/8 hover:text-white cursor-pointer"
          >
            <Store className="w-4 h-4 text-[#C99E44]" />
            <span>View Public Marketplace</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/8 hover:text-white cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-[#0B1F3A] text-white flex flex-col h-full">
            <div className="h-16 px-5 flex items-center justify-between border-b border-white/10">
              <BrandLogo variant="dark" compact />
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm ${
                      section === item.id ? 'bg-white/15 text-white' : 'text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                    {item.id === 'notifications' && unreadCount > 0 && (
                      <span className="font-mono text-xs text-[#C99E44]">{unreadCount}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-white/10 space-y-2">
              <button
                type="button"
                onClick={onGoToMarketplace}
                className="w-full text-left text-xs text-slate-300 py-2"
              >
                Public Marketplace
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="w-full text-left text-xs text-slate-300 py-2"
              >
                Sign Out
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="truncate">
              <span className="text-xs text-slate-500">Kigali Vault · Member Portal / </span>
              <span className="text-sm font-semibold text-[#0B1F3A]">
                {navItems.find((n) => n.id === section)?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setSection('notifications')}
              className="relative p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
              aria-label="Open notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-[#0B1F3A] text-[#F8F1E1] text-[10px] font-mono font-bold rounded flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onGoToMarketplace}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-slate-200 rounded-lg text-[#0B1F3A] hover:border-[#0B1F3A] whitespace-nowrap cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 text-[#9E7220]" />
              <span>Marketplace</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto">
          {loading && !dashboard ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-24 bg-white border border-slate-200 rounded-xl" />
              <div className="h-64 bg-white border border-slate-200 rounded-xl" />
            </div>
          ) : (
            <>
              {/* DASHBOARD */}
              {section === 'dashboard' && dashboard && (
                <div className="space-y-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                        {dashboard.storage.business_name}
                      </h1>
                      <p className="text-sm text-slate-500">
                        Storage ID{' '}
                        <span className="font-mono font-semibold text-[#9E7220]">
                          {dashboard.storage.storage_id}
                        </span>{' '}
                        · Account overview & real-time capacity
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSection('storage')}
                      className="px-4 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] self-start cursor-pointer whitespace-nowrap"
                    >
                      Request Additional Storage
                    </button>
                  </div>

                  {/* 4-column metric strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <div className="text-xs text-slate-500 mb-1">Total Revenue</div>
                      <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums">
                        {formatMoney(dashboard.sales_summary.total_revenue)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 tabular-nums">
                        {dashboard.sales_summary.completed_transactions} completed sales
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <div className="text-xs text-slate-500 mb-1">Allocated Space</div>
                      <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums">
                        {dashboard.storage.allocated_space_sqm} sqm
                      </div>
                      <div className="text-xs text-slate-500 mt-1 tabular-nums">
                        {dashboard.storage.remaining_capacity_sqm} sqm remaining ({storagePct}% used)
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <div className="text-xs text-slate-500 mb-1">Monthly Rental Fee</div>
                      <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums">
                        {formatMoney(dashboard.storage.monthly_rental_fee)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Linked to {dashboard.storage.storage_id}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                      <div className="text-xs text-slate-500 mb-1">Registered Products</div>
                      <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums">
                        {dashboard.product_summary.active_listings}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 tabular-nums">
                        {dashboard.product_summary.remaining_units} units in bay ·{' '}
                        {dashboard.product_summary.sold_units} sold
                      </div>
                    </div>
                  </div>

                  {/* Storage Utilization Bar */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="font-semibold text-[#0B1F3A]">
                        Warehouse Capacity Usage ({dashboard.storage.storage_id})
                      </span>
                      <span className="font-mono text-xs text-slate-600 tabular-nums">
                        {dashboard.storage.occupied_space_sqm} /{' '}
                        {dashboard.storage.allocated_space_sqm} sqm occupied
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0B1F3A] transition-all"
                        style={{ width: `${storagePct}%` }}
                      />
                    </div>
                  </div>

                  {/* Recent Sales & Notifications Split */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                          Recent Completed Sales
                        </h2>
                        <button
                          type="button"
                          onClick={() => setSection('sales')}
                          className="text-xs font-medium text-[#9E7220] hover:underline cursor-pointer"
                        >
                          View All
                        </button>
                      </div>
                      {dashboard.recent_sales.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">
                          No completed sales recorded yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {dashboard.recent_sales.map((s, idx) => (
                            <div
                              key={idx}
                              className="py-3 flex items-center justify-between gap-3 text-sm"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-[#0B1F3A] truncate">
                                  {s.product_name}
                                </div>
                                <div className="text-xs text-slate-500 font-mono">
                                  {s.order_reference} · Qty {s.quantity_sold}
                                </div>
                              </div>
                              <div className="font-mono font-semibold text-[#0B1F3A] tabular-nums shrink-0">
                                {formatMoney(s.total_amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                          Recent Notifications
                        </h2>
                        <button
                          type="button"
                          onClick={() => setSection('notifications')}
                          className="text-xs font-medium text-[#9E7220] hover:underline cursor-pointer"
                        >
                          Open Inbox
                        </button>
                      </div>
                      {dashboard.recent_notifications.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">
                          No notifications yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {dashboard.recent_notifications.slice(0, 4).map((n) => (
                            <div key={n.id} className="py-3">
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`text-sm font-medium ${
                                    n.is_read ? 'text-slate-700' : 'text-[#0B1F3A] font-semibold'
                                  }`}
                                >
                                  {n.title}
                                </span>
                                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                                  {formatDateShort(n.created_at)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                                {n.message}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STORAGE & ADDITIONAL SPACE REQUESTS */}
              {section === 'storage' && storageData && (
                <div className="space-y-8">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                      Storage Allocation & Expansion Requests
                    </h1>
                    <p className="text-sm text-slate-500">
                      Additional approved capacity updates your existing Storage ID{' '}
                      <span className="font-mono font-semibold text-[#9E7220]">
                        {storageData.storage.storage_id}
                      </span>{' '}
                      without generating a new ID.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                        Current Allocation Summary
                      </h2>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
                        <div>
                          <div className="text-xs text-slate-500">Storage ID</div>
                          <div className="font-mono text-lg font-bold text-[#9E7220]">
                            {storageData.storage.storage_id}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Allocated Space</div>
                          <div className="font-mono text-lg font-bold text-[#0B1F3A] tabular-nums">
                            {storageData.storage.allocated_space_sqm} sqm
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Occupied Space</div>
                          <div className="font-mono text-lg font-bold text-[#0B1F3A] tabular-nums">
                            {storageData.storage.occupied_space_sqm} sqm
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Remaining Capacity</div>
                          <div className="font-mono text-lg font-bold text-[#15803D] tabular-nums">
                            {storageData.storage.remaining_capacity_sqm} sqm
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Monthly Rental Fee</div>
                          <div className="font-mono text-lg font-bold text-[#0B1F3A] tabular-nums">
                            {formatMoney(storageData.storage.monthly_rental_fee)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A] mb-3">
                        Request Additional Storage
                      </h2>
                      {reqMessage && (
                        <div
                          className={`p-3 rounded-lg text-xs mb-3 border ${
                            reqMessage.type === 'ok'
                              ? 'bg-emerald-50 border-emerald-200 text-[#15803D]'
                              : 'bg-red-50 border-red-200 text-[#B91C1C]'
                          }`}
                        >
                          {reqMessage.text}
                        </div>
                      )}
                      <form onSubmit={handleRequestStorage} className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Additional Space Needed (sqm)
                          </label>
                          <input
                            type="number"
                            required
                            min={5}
                            max={2000}
                            value={extraSqm}
                            onChange={(e) => setExtraSqm(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                          />
                        </div>
                        <div className="text-xs text-slate-500 flex justify-between">
                          <span>Estimated Monthly Increase</span>
                          <span className="font-mono font-semibold text-[#0B1F3A] tabular-nums">
                            +
                            {formatMoney(
                              (Number(extraSqm) || 0) * storageData.storage.base_rate_per_sqm
                            )}
                          </span>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Reason / Inventory Plan
                          </label>
                          <textarea
                            rows={2}
                            required
                            value={extraReason}
                            onChange={(e) => setExtraReason(e.target.value)}
                            placeholder="e.g. Incoming Q4 palletized stock shipment"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={reqSubmitting}
                          className="w-full py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                        >
                          {reqSubmitting ? 'Submitting...' : 'Submit Space Request'}
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Additional Storage Requests Table */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                        Additional Storage Requests
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 font-medium">Requested Date</th>
                            <th className="py-3 px-4 font-medium">Extra Space</th>
                            <th className="py-3 px-4 font-medium">Fee Adjustment</th>
                            <th className="py-3 px-4 font-medium">Reason</th>
                            <th className="py-3 px-4 font-medium">Status</th>
                            <th className="py-3 px-6 font-medium">Staff Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {storageData.requests.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-8 text-center text-slate-500">
                                No additional storage requests submitted yet.
                              </td>
                            </tr>
                          ) : (
                            storageData.requests.map((r) => (
                              <tr key={r.id} className="hover:bg-slate-50/70">
                                <td className="py-3 px-6 font-mono text-xs text-slate-600 whitespace-nowrap">
                                  {formatDateShort(r.created_at)}
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums font-medium text-[#0B1F3A]">
                                  +{r.requested_extra_sqm} sqm
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                                  +{formatMoney(r.proposed_fee_increase)}
                                </td>
                                <td className="py-3 px-4 text-slate-600 max-w-xs">{r.reason}</td>
                                <td className="py-3 px-4">
                                  <StatusText status={r.status} />
                                </td>
                                <td className="py-3 px-6 text-xs text-slate-500">
                                  {r.staff_note || '—'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Storage Allocation History */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                        Storage Allocation History
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 font-medium">Date</th>
                            <th className="py-3 px-4 font-medium">Event</th>
                            <th className="py-3 px-4 font-medium">Allocation Change</th>
                            <th className="py-3 px-4 font-medium">Monthly Fee</th>
                            <th className="py-3 px-6 font-medium">Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {storageData.history.map((h, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/70">
                              <td className="py-3 px-6 font-mono text-xs text-slate-600 whitespace-nowrap">
                                {formatDateTime(h.created_at)}
                              </td>
                              <td className="py-3 px-4 text-xs font-medium text-[#0B1F3A]">
                                {h.change_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-xs">
                                {h.previous_space_sqm} → {h.new_space_sqm} sqm
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-xs">
                                {formatMoney(h.new_fee)}
                              </td>
                              <td className="py-3 px-6 text-xs text-slate-600">{h.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* MY PRODUCTS (READ-ONLY) */}
              {section === 'products' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                        My Warehouse Products
                      </h1>
                      <p className="text-sm text-slate-500">
                        Read-only catalog of inventory registered under{' '}
                        <span className="font-mono font-semibold text-[#9E7220]">
                          {authUser.storage_id}
                        </span>
                        . Product registration, pricing, and stock adjustments are exclusively managed by authorized warehouse staff.
                      </p>
                    </div>
                  </div>

                  {products.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                      <p className="text-base font-semibold text-[#0B1F3A] mb-1">
                        No products registered yet
                      </p>
                      <p className="text-sm text-slate-500">
                        Deliver your stock to the warehouse bay so authorized staff can inspect, photograph, and register your listings.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {products.map((p, idx) => (
                        <div
                          key={idx}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col sm:flex-row"
                        >
                          <div className="sm:w-44 h-44 sm:h-auto bg-slate-100 shrink-0">
                            <ProductImage
                              src={p.image_url}
                              alt={p.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="p-5 flex-1 flex flex-col">
                            <div className="flex items-center justify-between gap-2 text-xs mb-1">
                              <span className="text-slate-500">{p.category}</span>
                              <StatusText status={p.status} />
                            </div>
                            <h3 className="font-display text-base font-bold text-[#0B1F3A] mb-1">
                              {p.name}
                            </h3>
                            <p className="text-xs text-slate-600 line-clamp-2 mb-3">
                              {p.description}
                            </p>
                            <div className="mt-auto pt-3 border-t border-slate-100 grid grid-cols-2 gap-y-1.5 text-xs">
                              <div>
                                <span className="text-slate-500">Unit Price: </span>
                                <span className="font-mono font-semibold text-[#0B1F3A] tabular-nums">
                                  {formatMoney(p.price)}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500">Initial Qty: </span>
                                <span className="font-mono tabular-nums">
                                  {p.initial_qty} {p.unit_label}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500">Sold Qty: </span>
                                <span className="font-mono tabular-nums text-[#15803D] font-medium">
                                  {p.sold_qty} {p.unit_label}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500">Remaining: </span>
                                <span className="font-mono tabular-nums font-semibold text-[#0B1F3A]">
                                  {p.available_qty} {p.unit_label}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SALES HISTORY (NO CUSTOMER PII) */}
              {section === 'sales' && (
                <div className="space-y-6">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">Sales History</h1>
                    <p className="text-sm text-slate-500">
                      Order lines fulfilled from your storage allocation ({authUser.storage_id}). Customer contact information remains private.
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 font-medium">Date</th>
                            <th className="py-3 px-4 font-medium">Order Reference</th>
                            <th className="py-3 px-4 font-medium">Product</th>
                            <th className="py-3 px-4 font-medium text-right">Qty Sold</th>
                            <th className="py-3 px-4 font-medium text-right">Unit Price</th>
                            <th className="py-3 px-4 font-medium text-right">Total Amount</th>
                            <th className="py-3 px-6 font-medium">Order Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sales.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-10 text-center text-slate-500">
                                No sales orders recorded for your listings yet.
                              </td>
                            </tr>
                          ) : (
                            sales.map((s, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/70">
                                <td className="py-3 px-6 font-mono text-xs text-slate-600 whitespace-nowrap">
                                  {formatDateTime(s.sale_date)}
                                </td>
                                <td className="py-3 px-4 font-mono text-xs font-semibold text-[#0B1F3A]">
                                  {s.order_reference}
                                </td>
                                <td className="py-3 px-4 font-medium text-slate-800">
                                  {s.product_name}
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums text-right">
                                  {s.quantity_sold} {s.unit_label}
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-600">
                                  {formatMoney(s.unit_price)}
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                                  {formatMoney(s.total_amount)}
                                </td>
                                <td className="py-3 px-6">
                                  <StatusText status={s.order_status} />
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* NOTIFICATIONS */}
              {section === 'notifications' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                        Notifications
                      </h1>
                      <p className="text-sm text-slate-500">
                        Sales confirmations, inventory updates, storage changes, and announcements
                      </p>
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void markNotificationsRead()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-slate-200 bg-white rounded-lg text-[#0B1F3A] hover:border-[#0B1F3A] cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Mark All Read</span>
                      </button>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-10 text-center text-sm text-slate-500">
                        No notifications in your history.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`p-5 flex items-start justify-between gap-4 ${
                            n.is_read ? 'bg-white' : 'bg-[#FDFBF4]'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-medium text-[#9E7220]">
                                {n.category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                              </span>
                              <span>·</span>
                              <span className="font-mono">{formatDateTime(n.created_at)}</span>
                              {!n.is_read && (
                                <>
                                  <span>·</span>
                                  <span className="font-semibold text-[#0B1F3A]">Unread</span>
                                </>
                              )}
                            </div>
                            <h3 className="text-sm font-semibold text-[#0B1F3A]">{n.title}</h3>
                            <p className="text-sm text-slate-600">{n.message}</p>
                          </div>
                          {!n.is_read && (
                            <button
                              type="button"
                              onClick={() => void markNotificationsRead(n.id)}
                              className="text-xs font-medium text-[#0B1F3A] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Mark Read
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* REPORTS */}
              {section === 'reports' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                        Member Performance Report
                      </h1>
                      <p className="text-sm text-slate-500">
                        Completed sales revenue and product movement for {authUser.storage_id}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={reportFrom}
                        onChange={(e) => setReportFrom(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="date"
                        value={reportTo}
                        onChange={(e) => setReportTo(e.target.value)}
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => void loadReports()}
                        className="px-3.5 py-1.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Apply Filter
                      </button>
                    </div>
                  </div>

                  {reportData && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                          <div className="text-xs text-slate-500">Completed Sales Revenue</div>
                          <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                            {formatMoney(reportData.summary.total_revenue)}
                          </div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                          <div className="text-xs text-slate-500">Total Units Sold</div>
                          <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                            {reportData.summary.total_units_sold}
                          </div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                          <div className="text-xs text-slate-500">Completed Transactions</div>
                          <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                            {reportData.summary.total_transactions}
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-200">
                          <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                            Revenue by Product
                          </h2>
                        </div>
                        <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                            <tr>
                              <th className="py-3 px-6 font-medium">Product Name</th>
                              <th className="py-3 px-4 font-medium text-right">Transactions</th>
                              <th className="py-3 px-4 font-medium text-right">Units Sold</th>
                              <th className="py-3 px-6 font-medium text-right">Revenue</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {reportData.by_product.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-8 text-center text-slate-500">
                                  No completed sales in selected date range.
                                </td>
                              </tr>
                            ) : (
                              reportData.by_product.map((row) => (
                                <tr key={row.product_name}>
                                  <td className="py-3 px-6 font-medium text-[#0B1F3A]">
                                    {row.product_name}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-right">
                                    {row.sale_count}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-right">
                                    {row.units_sold}
                                  </td>
                                  <td className="py-3 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                                    {formatMoney(row.revenue)}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
