import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  Expand,
  LayoutDashboard,
  LogOut,
  Menu,
  Store,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';
import {
  InventoryManagementPanel,
  MembersDirectoryPanel,
  OperationalReportsPanel,
  OrdersFulfillmentPanel,
  StorageApplicationsPanel,
  StorageRequestsPanel,
} from './OperationsWorkspace.tsx';
import { BrandLogo } from './BrandLogo.tsx';

interface StaffPortalProps {
  authUser: AuthUser;
  onGoToMarketplace: () => void;
  onLogout: () => void;
}

type StaffSection =
  | 'overview'
  | 'applications'
  | 'expansions'
  | 'inventory'
  | 'orders'
  | 'members'
  | 'reports';

export function StaffPortal({ authUser, onGoToMarketplace, onLogout }: StaffPortalProps) {
  const perms = authUser.staff_permissions;
  const [section, setSection] = useState<StaffSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [summary, setSummary] = useState({
    pending_applications: 0,
    pending_storage_requests: 0,
    active_listings: 0,
    open_orders: 0,
  });

  const loadSummary = async () => {
    try {
      const res = await apiFetch<typeof summary>('/api/operations/summary');
      setSummary(res);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

  const navItems: Array<{
    id: StaffSection;
    label: string;
    icon: typeof LayoutDashboard;
    allowed: boolean;
    count?: number;
  }> = [
    { id: 'overview', label: 'Operations Overview', icon: LayoutDashboard, allowed: true },
    {
      id: 'applications',
      label: 'Storage Applications',
      icon: Warehouse,
      allowed: Boolean(perms?.can_manage_storage),
      count: summary.pending_applications,
    },
    {
      id: 'expansions',
      label: 'Space Requests',
      icon: Expand,
      allowed: Boolean(perms?.can_manage_storage),
      count: summary.pending_storage_requests,
    },
    {
      id: 'inventory',
      label: 'Products & Inventory',
      icon: Boxes,
      allowed: Boolean(perms?.can_manage_inventory),
      count: summary.active_listings,
    },
    {
      id: 'orders',
      label: 'Orders & Fulfillment',
      icon: ClipboardCheck,
      allowed: Boolean(perms?.can_manage_orders),
      count: summary.open_orders,
    },
    {
      id: 'members',
      label: 'Members Directory',
      icon: Users,
      allowed: Boolean(perms?.can_assist_members),
    },
    {
      id: 'reports',
      label: 'Operational Reports',
      icon: BarChart3,
      allowed: Boolean(perms?.can_view_reports),
    },
  ];

  const permittedItems = navItems.filter((i) => i.allowed);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0B1F3A] text-white shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-white/10">
          <BrandLogo variant="dark" />
        </div>

        <div className="px-6 py-4 border-b border-white/10">
          <div className="font-mono text-sm font-bold text-[#C99E44]">
            {perms?.staff_code || 'Staff'}
          </div>
          <div className="text-sm font-semibold text-white mt-0.5">{authUser.full_name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{perms?.title || 'Warehouse Staff'}</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {permittedItems.map((item) => {
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
                {typeof item.count === 'number' && item.count > 0 && (
                  <span className="font-mono text-xs text-[#C99E44] tabular-nums">
                    {item.count}
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
            <span>Public Marketplace</span>
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

      {/* Mobile Drawer */}
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
              {permittedItems.map((item) => {
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
              <span className="text-xs text-slate-500">Kigali Vault · Staff Operations / </span>
              <span className="text-sm font-semibold text-[#0B1F3A]">
                {permittedItems.find((n) => n.id === section)?.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onGoToMarketplace}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-slate-200 rounded-lg text-[#0B1F3A] hover:border-[#0B1F3A] whitespace-nowrap cursor-pointer"
          >
            <Store className="w-3.5 h-3.5 text-[#9E7220]" />
            <span>Marketplace</span>
          </button>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto">
          {section === 'overview' && (
            <div className="space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                  Welcome, {authUser.full_name}
                </h1>
                <p className="text-sm text-slate-500">
                  Signed in as <span className="font-mono font-semibold text-[#9E7220]">{perms?.staff_code}</span> ({perms?.title}). Modules below reflect your Super Admin-assigned permissions.
                </p>
              </div>

              {/* Assigned Permissions Summary */}
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="font-display text-sm font-bold text-[#0B1F3A] mb-3">
                  Authorized Operational Scopes
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  {[
                    { label: 'Storage Applications & Space', on: perms?.can_manage_storage },
                    { label: 'Products & Inventory', on: perms?.can_manage_inventory },
                    { label: 'Orders & Sales Completion', on: perms?.can_manage_orders },
                    { label: 'Member Assistance', on: perms?.can_assist_members },
                    { label: 'Operational Reports', on: perms?.can_view_reports },
                  ].map((p) => (
                    <div
                      key={p.label}
                      className={`p-3 rounded-lg border ${
                        p.on
                          ? 'bg-[#FDFBF4] border-[#C99E44]/50 text-[#0B1F3A]'
                          : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}
                    >
                      <div className="font-semibold">{p.label}</div>
                      <div className="mt-1 font-mono text-[11px]">
                        {p.on ? 'Authorized' : 'Restricted'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Operational Queues */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {perms?.can_manage_storage && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSection('applications')}
                      className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-[#0B1F3A] transition-colors cursor-pointer"
                    >
                      <div className="text-xs text-slate-500">Pending Storage Apps</div>
                      <div className="font-mono text-2xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                        {summary.pending_applications}
                      </div>
                      <div className="text-xs text-[#9E7220] font-medium mt-2">Review queue →</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSection('expansions')}
                      className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-[#0B1F3A] transition-colors cursor-pointer"
                    >
                      <div className="text-xs text-slate-500">Additional Space Requests</div>
                      <div className="font-mono text-2xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                        {summary.pending_storage_requests}
                      </div>
                      <div className="text-xs text-[#9E7220] font-medium mt-2">Review requests →</div>
                    </button>
                  </>
                )}
                {perms?.can_manage_inventory && (
                  <button
                    type="button"
                    onClick={() => setSection('inventory')}
                    className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-[#0B1F3A] transition-colors cursor-pointer"
                  >
                    <div className="text-xs text-slate-500">Active Warehouse Listings</div>
                    <div className="font-mono text-2xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                      {summary.active_listings}
                    </div>
                    <div className="text-xs text-[#9E7220] font-medium mt-2">Manage inventory →</div>
                  </button>
                )}
                {perms?.can_manage_orders && (
                  <button
                    type="button"
                    onClick={() => setSection('orders')}
                    className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-[#0B1F3A] transition-colors cursor-pointer"
                  >
                    <div className="text-xs text-slate-500">Open Customer Orders</div>
                    <div className="font-mono text-2xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                      {summary.open_orders}
                    </div>
                    <div className="text-xs text-[#9E7220] font-medium mt-2">Process orders →</div>
                  </button>
                )}
              </div>
            </div>
          )}

          {section === 'applications' && perms?.can_manage_storage && (
            <StorageApplicationsPanel onChanged={loadSummary} />
          )}
          {section === 'expansions' && perms?.can_manage_storage && (
            <StorageRequestsPanel onChanged={loadSummary} />
          )}
          {section === 'inventory' && perms?.can_manage_inventory && (
            <InventoryManagementPanel onChanged={loadSummary} />
          )}
          {section === 'orders' && perms?.can_manage_orders && (
            <OrdersFulfillmentPanel onChanged={loadSummary} />
          )}
          {section === 'members' && perms?.can_assist_members && <MembersDirectoryPanel />}
          {section === 'reports' && perms?.can_view_reports && <OperationalReportsPanel />}
        </main>
      </div>
    </div>
  );
}
