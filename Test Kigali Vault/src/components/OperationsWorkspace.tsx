import {
  Archive,
  ArrowUpDown,
  CheckCircle2,
  Edit3,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  apiFetch,
  formatDateShort,
  formatDateTime,
  formatMoney,
  getStoredToken,
} from '../lib/api.ts';
import type { OrderDetails, OperationalProduct, ProductCategory } from '../types.ts';
import { ProductImage } from './ProductImage.tsx';
import { StatusText } from './StatusText.tsx';

const STUDIO_PRESET_IMAGES = [
  { label: 'Portland Cement', url: '/src/assets/images/product_portland_cement_1794824614753.jpg' },
  { label: 'Arabica Coffee', url: '/src/assets/images/product_arabica_coffee_1794824615810.jpg' },
  { label: 'Solar Inverter', url: '/src/assets/images/product_solar_inverter_1794824617214.jpg' },
  { label: 'Steel Rebar', url: '/src/assets/images/product_steel_rebar_1794824616251.jpg' },
  { label: 'Cooking Oil 5L', url: '/src/assets/images/product_cooking_oil_1794824616565.jpg' },
  { label: 'Porcelain Tiles', url: '/src/assets/images/product_ceramic_tiles_1794824617349.jpg' },
];

// ========================
// 1. STORAGE APPLICATIONS PANEL
// ========================
export function StorageApplicationsPanel({ onChanged }: { onChanged?: () => void }) {
  const [applications, setApplications] = useState<
    Array<{
      id: number;
      business_name: string;
      storage_id: string | null;
      application_status: string;
      requested_space_sqm: number;
      allocated_space_sqm: number;
      monthly_rental_fee: number;
      notes: string;
      rejection_reason: string;
      created_at: string;
      full_name: string;
      email: string;
      phone: string;
    }>
  >([]);
  const [baseRate, setBaseRate] = useState(1500);
  const [loading, setLoading] = useState(true);
  const [reviewingApp, setReviewingApp] = useState<(typeof applications)[0] | null>(null);
  const [allocSpace, setAllocSpace] = useState('');
  const [allocFee, setAllocFee] = useState('');
  const [allocNote, setAllocNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        applications: typeof applications;
        base_rate_per_sqm: number;
      }>('/api/operations/storage-applications');
      setApplications(res.applications);
      setBaseRate(res.base_rate_per_sqm);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitReview = async (decision: 'approve' | 'reject') => {
    if (!reviewingApp) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ status: string; storage_id: string | null }>(
        `/api/operations/storage-applications/${reviewingApp.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify(
            decision === 'approve'
              ? {
                  decision: 'approve',
                  allocated_space_sqm: Number(allocSpace),
                  monthly_rental_fee: Number(allocFee),
                  note: allocNote,
                }
              : {
                  decision: 'reject',
                  rejection_reason: rejectReason,
                }
          ),
        }
      );
      setReviewingApp(null);
      setFeedback(
        decision === 'approve'
          ? `Approved ${reviewingApp.business_name} and generated permanent Storage ID ${res.storage_id}.`
          : `Application for ${reviewingApp.business_name} rejected.`
      );
      await load();
      onChanged?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
          Member Storage Applications
        </h1>
        <p className="text-sm text-slate-500">
          Approving an application automatically assigns one permanent, non-reusable Storage ID.
        </p>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 text-xs font-medium text-[#0B1F3A]">
          {feedback}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-6 font-medium">Applicant / Business</th>
                <th className="py-3 px-4 font-medium">Contact</th>
                <th className="py-3 px-4 font-medium">Storage ID</th>
                <th className="py-3 px-4 font-medium text-right">Requested / Allocated</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-6 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Loading applications...
                  </td>
                </tr>
              ) : (
                applications.map((app) => (
                  <tr key={app.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-[#0B1F3A]">{app.business_name}</div>
                      <div className="text-xs text-slate-500">
                        {app.full_name} · Applied {formatDateShort(app.created_at)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      <div>{app.email}</div>
                      <div className="font-mono">{app.phone}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-[#9E7220]">
                      {app.storage_id || 'Pending ID'}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right text-xs">
                      {app.application_status === 'approved'
                        ? `${app.allocated_space_sqm} sqm`
                        : `${app.requested_space_sqm} sqm (req)`}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={app.application_status} />
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      {app.application_status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewingApp(app);
                            setAllocSpace(String(app.requested_space_sqm));
                            setAllocFee(String(app.requested_space_sqm * baseRate));
                            setAllocNote('');
                            setRejectReason('');
                          }}
                          className="px-3 py-1.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer whitespace-nowrap"
                        >
                          Review
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Reviewed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reviewingApp && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                Review Application · {reviewingApp.business_name}
              </h3>
              <button
                type="button"
                onClick={() => setReviewingApp(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                <div>
                  Applicant: <strong className="text-[#0B1F3A]">{reviewingApp.full_name}</strong> ({reviewingApp.phone})
                </div>
                <div>Requested Space: {reviewingApp.requested_space_sqm} sqm</div>
                {reviewingApp.notes && <div>Notes: {reviewingApp.notes}</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Allocated Space (sqm)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={allocSpace}
                    onChange={(e) => {
                      setAllocSpace(e.target.value);
                      setAllocFee(String((Number(e.target.value) || 0) * baseRate));
                    }}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Rental Fee (RWF)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={allocFee}
                    onChange={(e) => setAllocFee(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Approval Note (or Rejection Reason)
                </label>
                <input
                  type="text"
                  value={allocNote || rejectReason}
                  onChange={(e) => {
                    setAllocNote(e.target.value);
                    setRejectReason(e.target.value);
                  }}
                  placeholder="Bay assignment note or reason for rejection"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitReview('reject')}
                  className="px-4 py-2 border border-red-200 text-[#B91C1C] text-xs font-semibold rounded-lg hover:bg-red-50 cursor-pointer"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitReview('approve')}
                  className="px-5 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                >
                  Approve & Assign Storage ID
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// 2. ADDITIONAL STORAGE REQUESTS PANEL
// ========================
export function StorageRequestsPanel({ onChanged }: { onChanged?: () => void }) {
  const [requests, setRequests] = useState<
    Array<{
      id: number;
      storage_id: string;
      business_name: string;
      allocated_space_sqm: number;
      monthly_rental_fee: number;
      requested_extra_sqm: number;
      proposed_fee_increase: number;
      reason: string;
      status: string;
      staff_note: string;
      created_at: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [activeReq, setActiveReq] = useState<(typeof requests)[0] | null>(null);
  const [extraSqm, setExtraSqm] = useState('');
  const [feeIncrease, setFeeIncrease] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ requests: typeof requests }>('/api/operations/storage-requests');
      setRequests(res.requests);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleDecision = async (decision: 'approve' | 'reject') => {
    if (!activeReq) return;
    setFeedback(null);
    try {
      await apiFetch(`/api/operations/storage-requests/${activeReq.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          approved_extra_sqm: Number(extraSqm),
          fee_increase: Number(feeIncrease),
          staff_note: staffNote,
        }),
      });
      setFeedback(
        decision === 'approve'
          ? `Approved +${extraSqm} sqm under existing Storage ID ${activeReq.storage_id}.`
          : `Declined expansion request for ${activeReq.storage_id}.`
      );
      setActiveReq(null);
      await load();
      onChanged?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to process request.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
          Additional Storage Requests
        </h1>
        <p className="text-sm text-slate-500">
          Approving expansion updates the member&apos;s existing Storage ID capacity and rental fee.
        </p>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 text-xs font-medium text-[#0B1F3A]">
          {feedback}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-6 font-medium">Storage ID</th>
                <th className="py-3 px-4 font-medium">Member</th>
                <th className="py-3 px-4 font-medium text-right">Current → Requested</th>
                <th className="py-3 px-4 font-medium">Reason</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-6 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Loading requests...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No additional storage requests found.
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-6 font-mono font-bold text-[#9E7220]">
                      {r.storage_id}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-[#0B1F3A]">{r.business_name}</div>
                      <div className="text-xs text-slate-400">{formatDateShort(r.created_at)}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right text-xs">
                      {r.allocated_space_sqm} sqm (+{r.requested_extra_sqm} sqm)
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs">{r.reason}</td>
                    <td className="py-3.5 px-4">
                      <StatusText status={r.status} />
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      {r.status === 'Pending' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveReq(r);
                            setExtraSqm(String(r.requested_extra_sqm));
                            setFeeIncrease(String(r.proposed_fee_increase));
                            setStaffNote('');
                          }}
                          className="px-3 py-1.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                        >
                          Review
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">{r.staff_note || 'Processed'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {activeReq && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                Expansion Request · {activeReq.storage_id}
              </h3>
              <button
                type="button"
                onClick={() => setActiveReq(null)}
                className="p-1 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <p className="text-xs text-slate-600">{activeReq.reason}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Approved Extra (sqm)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={extraSqm}
                    onChange={(e) => setExtraSqm(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Fee Increase (RWF)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={feeIncrease}
                    onChange={(e) => setFeeIncrease(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Staff Note</label>
                <input
                  type="text"
                  value={staffNote}
                  onChange={(e) => setStaffNote(e.target.value)}
                  placeholder="Optional bay note or rejection reason"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void handleDecision('reject')}
                  className="px-4 py-2 border border-red-200 text-[#B91C1C] text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void handleDecision('approve')}
                  className="px-4 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Approve & Update {activeReq.storage_id}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// 3. INVENTORY & PRODUCT REGISTRATION PANEL
// ========================
export function InventoryManagementPanel({ onChanged }: { onChanged?: () => void }) {
  const [products, setProducts] = useState<OperationalProduct[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [members, setMembers] = useState<
    Array<{ id: number; storage_id: string; business_name: string; allocated_space_sqm: number; occupied_space_sqm: number }>
  >([]);
  const [movements, setMovements] = useState<
    Array<{
      id: number;
      storage_id: string;
      product_name: string;
      unit_label: string;
      movement_type: string;
      qty_change: number;
      qty_before: number;
      qty_after: number;
      reference: string;
      note: string;
      actor_name: string;
      created_at: string;
    }>
  >([]);
  const [tab, setTab] = useState<'listings' | 'movements'>('listings');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Register / Edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [formStorageId, setFormStorageId] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Construction Materials');
  const [formDesc, setFormDesc] = useState('');
  const [formUnit, setFormUnit] = useState('bags');
  const [formPrice, setFormPrice] = useState('12000');
  const [formQty, setFormQty] = useState('40');
  const [formSpacePerUnit, setFormSpacePerUnit] = useState('0.35');
  const [formImageUrl, setFormImageUrl] = useState(STUDIO_PRESET_IMAGES[0].url);
  const [uploadingImg, setUploadingImg] = useState(false);

  // Dynamic Category Manager inside modal
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryEditorMode, setCategoryEditorMode] = useState<'add' | 'edit'>('add');
  const [categoryInputName, setCategoryInputName] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // Stock adjustment modal
  const [adjustTarget, setAdjustTarget] = useState<OperationalProduct | null>(null);
  const [adjustType, setAdjustType] = useState<'restock' | 'adjustment'>('restock');
  const [adjustQty, setAdjustQty] = useState('10');
  const [adjustNote, setAdjustNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [prodRes, memRes, movRes, catRes] = await Promise.all([
        apiFetch<{ products: OperationalProduct[] }>('/api/operations/products'),
        apiFetch<{ members: typeof members }>('/api/operations/approved-members'),
        apiFetch<{ movements: typeof movements }>('/api/operations/inventory-movements'),
        apiFetch<{ categories: ProductCategory[] }>('/api/operations/categories'),
      ]);
      setProducts(prodRes.products);
      setMembers(memRes.members);
      setMovements(movRes.movements);
      setCategories(catRes.categories);
      if (memRes.members.length > 0 && !formStorageId) {
        setFormStorageId(memRes.members[0].storage_id);
      }
      if (catRes.categories.length > 0 && !catRes.categories.some((c) => c.name === formCategory)) {
        setFormCategory(catRes.categories[0].name);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ url: string }>('/api/operations/upload-image', {
        method: 'POST',
        body: JSON.stringify({ data_url: dataUrl, filename: file.name }),
      });
      setFormImageUrl(res.url);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploadingImg(false);
    }
  };

  const openCreateModal = () => {
    setEditingToken(null);
    setFormStorageId(members[0]?.storage_id || '');
    setFormName('');
    setFormCategory(categories[0]?.name || 'Construction Materials');
    setFormDesc('');
    setFormUnit('units');
    setFormPrice('');
    setFormQty('25');
    setFormSpacePerUnit('0.3');
    setFormImageUrl(STUDIO_PRESET_IMAGES[0].url);
    setCategoryEditorOpen(false);
    setCategoryError(null);
    setFormOpen(true);
  };

  const openEditModal = (p: OperationalProduct) => {
    setEditingToken(p.listing_token);
    setFormStorageId(p.storage_id);
    setFormName(p.name);
    setFormCategory(p.category);
    setFormDesc(p.description);
    setFormUnit(p.unit_label);
    setFormPrice(String(p.price));
    setFormImageUrl(p.image_url);
    setCategoryEditorOpen(false);
    setCategoryError(null);
    setFormOpen(true);
  };

  const handleSaveCategory = async () => {
    setCategoryError(null);
    const trimmed = categoryInputName.trim();
    if (!trimmed) {
      setCategoryError('Enter a category name.');
      return;
    }
    setCategorySaving(true);
    try {
      if (categoryEditorMode === 'add') {
        const res = await apiFetch<{ category: ProductCategory }>('/api/operations/categories', {
          method: 'POST',
          body: JSON.stringify({ name: trimmed }),
        });
        const catRes = await apiFetch<{ categories: ProductCategory[] }>('/api/operations/categories');
        setCategories(catRes.categories);
        setFormCategory(res.category.name);
        setFeedback(`Category "${res.category.name}" added and selected.`);
      } else {
        const selected = categories.find((c) => c.name === formCategory);
        if (!selected) {
          setCategoryError('Select an existing category to rename.');
          setCategorySaving(false);
          return;
        }
        const res = await apiFetch<{ category: ProductCategory }>(
          `/api/operations/categories/${selected.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ name: trimmed }),
          }
        );
        await load();
        setFormCategory(res.category.name);
        setFeedback(`Renamed category to "${res.category.name}".`);
      }
      setCategoryEditorOpen(false);
      setCategoryInputName('');
      onChanged?.();
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Unable to save category.');
    } finally {
      setCategorySaving(false);
    }
  };

  const submitProductForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      if (editingToken) {
        await apiFetch(`/api/operations/products/${editingToken}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formName,
            category: formCategory,
            description: formDesc,
            unit_label: formUnit,
            price: Number(formPrice),
            image_url: formImageUrl,
          }),
        });
        setFeedback(`Updated listing "${formName}" (${formStorageId}).`);
      } else {
        await apiFetch('/api/operations/products', {
          method: 'POST',
          body: JSON.stringify({
            storage_id: formStorageId,
            name: formName,
            category: formCategory,
            description: formDesc,
            unit_label: formUnit,
            price: Number(formPrice),
            initial_qty: Number(formQty),
            space_per_unit_sqm: Number(formSpacePerUnit),
            image_url: formImageUrl,
          }),
        });
        setFeedback(`Registered "${formName}" under Storage ID ${formStorageId}.`);
      }
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to save product.');
    }
  };

  const toggleArchive = async (p: OperationalProduct) => {
    const nextStatus = p.status === 'Archived' ? 'Available' : 'Archived';
    await apiFetch(`/api/operations/products/${p.listing_token}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    setFeedback(`${p.name} (${p.storage_id}) set to ${nextStatus}.`);
    await load();
    onChanged?.();
  };

  const submitStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setFeedback(null);
    try {
      await apiFetch(`/api/operations/products/${adjustTarget.listing_token}/adjust-stock`, {
        method: 'POST',
        body: JSON.stringify({
          movement_type: adjustType,
          qty_change: Number(adjustQty),
          note: adjustNote,
        }),
      });
      setFeedback(`Stock updated for ${adjustTarget.name} (${adjustTarget.storage_id}).`);
      setAdjustTarget(null);
      await load();
      onChanged?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Stock adjustment failed.');
    }
  };

  const visibleProducts = products.filter((p) => {
    if (!search.trim()) return true;
    const hay = `${p.name} ${p.storage_id} ${p.business_name} ${p.category}`.toLowerCase();
    return hay.includes(search.trim().toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
            Product & Inventory Operations
          </h1>
          <p className="text-sm text-slate-500">
            Register member listings, upload product photography, adjust stock, and record inventory movements.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer whitespace-nowrap self-start"
        >
          <PackagePlus className="w-4 h-4 text-[#C99E44]" />
          <span>Register New Product</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 text-xs font-medium text-[#0B1F3A]">
          {feedback}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('listings')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
              tab === 'listings' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-slate-600'
            }`}
          >
            Warehouse Listings ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
              tab === 'movements' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-slate-600'
            }`}
          >
            Inventory Movement Log ({movements.length})
          </button>
        </div>

        {tab === 'listings' && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by product or Storage ID..."
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg w-64 focus:outline-none focus:border-[#0B1F3A]"
          />
        )}
      </div>

      {tab === 'listings' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-6 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">Seller Storage ID</th>
                  <th className="py-3 px-4 font-medium text-right">Price</th>
                  <th className="py-3 px-4 font-medium text-right">Stock (Avail / Sold)</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-6 font-medium text-right">Operations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Loading listings...
                    </td>
                  </tr>
                ) : (
                  visibleProducts.map((p) => (
                    <tr key={p.listing_token} className="hover:bg-slate-50/70">
                      <td className="py-3 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-10 rounded-md overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                            <ProductImage
                              src={p.image_url}
                              alt={p.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div>
                            <div className="font-semibold text-[#0B1F3A]">{p.name}</div>
                            <div className="text-xs text-slate-500">{p.category}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-[#9E7220]">{p.storage_id}</div>
                        <div className="text-xs text-slate-500">{p.business_name}</div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right font-medium">
                        {formatMoney(p.price)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-xs">
                        <span className="font-semibold text-[#0B1F3A]">{p.available_qty}</span>
                        <span className="text-slate-400"> / {p.sold_qty} sold</span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={p.status} />
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustTarget(p);
                              setAdjustType('restock');
                              setAdjustQty('10');
                              setAdjustNote('');
                            }}
                            title="Adjust / Restock"
                            className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:border-[#0B1F3A] text-[#0B1F3A] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ArrowUpDown className="w-3.5 h-3.5" />
                            <span>Stock</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            title="Edit Listing"
                            className="p-1.5 text-slate-600 border border-slate-200 rounded-md hover:border-[#0B1F3A] cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleArchive(p)}
                            title={p.status === 'Archived' ? 'Restore Listing' : 'Archive Listing'}
                            className="p-1.5 text-slate-600 border border-slate-200 rounded-md hover:border-[#B91C1C] cursor-pointer"
                          >
                            {p.status === 'Archived' ? (
                              <RotateCcw className="w-3.5 h-3.5 text-[#15803D]" />
                            ) : (
                              <Archive className="w-3.5 h-3.5 text-[#B91C1C]" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-6 font-medium">Timestamp</th>
                  <th className="py-3 px-4 font-medium">Storage ID</th>
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium text-right">Change (Before → After)</th>
                  <th className="py-3 px-6 font-medium">Recorded By / Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-6 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {formatDateTime(m.created_at)}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[#9E7220]">
                      {m.storage_id}
                    </td>
                    <td className="py-3 px-4 font-medium text-[#0B1F3A]">{m.product_name}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {m.movement_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-xs">
                      <span className={m.qty_change >= 0 ? 'text-[#15803D] font-semibold' : 'text-[#B91C1C] font-semibold'}>
                        {m.qty_change >= 0 ? `+${m.qty_change}` : m.qty_change}
                      </span>{' '}
                      <span className="text-slate-400">
                        ({m.qty_before} → {m.qty_after})
                      </span>
                    </td>
                    <td className="py-3 px-6 text-xs text-slate-600">
                      <span className="font-semibold text-[#0B1F3A]">{m.actor_name}</span> · {m.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Register / Edit Product Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-xl w-full overflow-hidden shadow-xl max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                {editingToken ? 'Edit Product Listing' : 'Register Product for Member'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitProductForm} className="p-6 overflow-y-auto space-y-4">
              {!editingToken && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Member Storage ID *
                  </label>
                  <select
                    required
                    value={formStorageId}
                    onChange={(e) => setFormStorageId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {members.map((m) => (
                      <option key={m.storage_id} value={m.storage_id}>
                        {m.storage_id} — {m.business_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Portland Cement (50kg Bag)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700">Category *</label>
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryEditorOpen((v) => !v);
                        setCategoryEditorMode('add');
                        setCategoryInputName('');
                        setCategoryError(null);
                      }}
                      className="text-[11px] font-semibold text-[#9E7220] hover:underline whitespace-nowrap cursor-pointer"
                    >
                      {categoryEditorOpen ? 'Close Category Editor' : '+ Add / Edit Category'}
                    </button>
                  </div>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {categoryEditorOpen && (
                <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0B1F3A]">
                      Dynamic Category Manager
                    </span>
                    <div className="inline-flex p-0.5 bg-white border border-slate-200 rounded-md">
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryEditorMode('add');
                          setCategoryInputName('');
                          setCategoryError(null);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                          categoryEditorMode === 'add'
                            ? 'bg-[#0B1F3A] text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        Add New
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryEditorMode('edit');
                          setCategoryInputName(formCategory);
                          setCategoryError(null);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                          categoryEditorMode === 'edit'
                            ? 'bg-[#0B1F3A] text-white'
                            : 'text-slate-600'
                        }`}
                      >
                        Rename Selected
                      </button>
                    </div>
                  </div>
                  {categoryError && (
                    <div className="text-xs text-[#B91C1C]">{categoryError}</div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={categoryInputName}
                      onChange={(e) => setCategoryInputName(e.target.value)}
                      placeholder={
                        categoryEditorMode === 'add'
                          ? 'New category name (e.g. Plumbing & Pipes)'
                          : `Rename "${formCategory}"...`
                      }
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                    />
                    <button
                      type="button"
                      disabled={categorySaving}
                      onClick={() => void handleSaveCategory()}
                      className="px-3.5 py-1.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] whitespace-nowrap cursor-pointer"
                    >
                      {categorySaving
                        ? 'Saving...'
                        : categoryEditorMode === 'add'
                          ? 'Save Category'
                          : 'Rename Category'}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Description *
                </label>
                <textarea
                  rows={2}
                  required
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Price (RWF) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Unit Label *
                  </label>
                  <input
                    type="text"
                    required
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="bags"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                {!editingToken && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Initial Qty *
                      </label>
                      <input
                        type="number"
                        required
                        min={0}
                        value={formQty}
                        onChange={(e) => setFormQty(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Sqm / Unit
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        min={0.05}
                        value={formSpacePerUnit}
                        onChange={(e) => setFormSpacePerUnit(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Product Photo (Upload or Select Warehouse Studio Asset)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                    <Upload className="w-3.5 h-3.5 text-[#0B1F3A]" />
                    <span>{uploadingImg ? 'Uploading...' : 'Upload Photo'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                  <select
                    value={
                      STUDIO_PRESET_IMAGES.some((i) => i.url === formImageUrl) ? formImageUrl : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) setFormImageUrl(e.target.value);
                    }}
                    className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Or pick studio image...</option>
                    {STUDIO_PRESET_IMAGES.map((img) => (
                      <option key={img.url} value={img.url}>
                        {img.label}
                      </option>
                    ))}
                  </select>
                </div>
                {formImageUrl && (
                  <div className="w-32 h-24 rounded-lg overflow-hidden border border-slate-200">
                    <ProductImage
                      src={formImageUrl}
                      alt="Product preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                >
                  {editingToken ? 'Save Changes' : 'Register Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                Update Stock · {adjustTarget.storage_id}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1 text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitStockAdjustment} className="p-6 space-y-4">
              <div className="text-xs text-slate-600">
                <strong className="text-[#0B1F3A]">{adjustTarget.name}</strong> · Current Stock:{' '}
                <span className="font-mono font-semibold">
                  {adjustTarget.available_qty} {adjustTarget.unit_label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustType('restock')}
                  className={`py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                    adjustType === 'restock'
                      ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  Restock (+)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType('adjustment')}
                  className={`py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                    adjustType === 'adjustment'
                      ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  Audit Adjustment (+/-)
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Quantity Change ({adjustTarget.unit_label})
                </label>
                <input
                  type="number"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Movement Note *
                </label>
                <input
                  type="text"
                  required
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="e.g. Received new pallet delivery"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Record Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// 4. ORDERS & FULFILLMENT PANEL
// ========================
export function OrdersFulfillmentPanel({ onChanged }: { onChanged?: () => void }) {
  const [orders, setOrders] = useState<OrderDetails[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<{ orders: OrderDetails[] }>('/api/operations/orders');
      setOrders(res.orders);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const token = getStoredToken();
    const streamUrl = token
      ? `/api/operations/orders/stream?token=${encodeURIComponent(token)}`
      : '/api/operations/orders/stream';

    let es: EventSource | null = null;
    try {
      es = new EventSource(streamUrl);
      es.addEventListener('order_update', () => {
        void load(true);
        onChanged?.();
      });
    } catch {
      // Fallback to polling below
    }

    const pollTimer = window.setInterval(() => {
      void load(true);
    }, 4000);

    return () => {
      es?.close();
      window.clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (orderRef: string, nextStatus: OrderDetails['status']) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/operations/orders/${orderRef}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedback({
        type: 'ok',
        text:
          nextStatus === 'Completed'
            ? `Order ${orderRef} marked Completed. Inventory deducted, sales recorded, and member notified.`
            : `Order ${orderRef} updated to ${nextStatus}.`,
      });
      await load();
      onChanged?.();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update order.',
      });
    }
  };

  const statuses = [
    'All',
    'Pending Confirmation',
    'Confirmed',
    'Ready for Collection',
    'Out for Delivery',
    'Completed',
    'Cancelled',
  ];

  const visible = orders.filter((o) => statusFilter === 'All' || o.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
            Customer Orders & Fulfillment
          </h1>
          <p className="text-sm text-slate-500">
            Marking an order Completed atomically deducts listing stock, records member sales, and prevents duplicate processing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 bg-white rounded-lg text-slate-700 hover:border-[#0B1F3A] self-start cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg text-xs font-medium border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-[#15803D]'
              : 'bg-red-50 border-red-200 text-[#B91C1C]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-lg">
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              statusFilter === s ? 'bg-white text-[#0B1F3A] shadow-sm font-semibold' : 'text-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            Loading orders...
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            No orders match the selected status filter.
          </div>
        ) : (
          visible.map((order) => {
            const locked = order.status === 'Completed' || order.status === 'Cancelled';
            const customerReceived = order.customer_confirmed_received === 1;

            const cardClass = locked
              ? 'bg-white border border-slate-200 rounded-xl p-5 space-y-4'
              : customerReceived
                ? 'bg-emerald-50/75 border border-[#15803D] border-l-4 border-l-[#15803D] rounded-xl p-5 space-y-4 transition-colors duration-300'
                : 'bg-[#0B1F3A]/[0.03] border border-[#0B1F3A]/35 border-l-4 border-l-[#0B1F3A] rounded-xl p-5 space-y-4 transition-colors duration-300';

            return (
              <div key={order.order_reference} className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-4 pb-3 border-b border-slate-200/80">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-base font-bold text-[#0B1F3A]">
                        {order.order_reference}
                      </span>
                      {!locked ? (
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold tracking-wide text-white transition-colors duration-300 ${
                            customerReceived ? 'bg-[#15803D]' : 'bg-[#0B1F3A]'
                          }`}
                        >
                          {customerReceived && <CheckCircle2 className="w-3.5 h-3.5" />}
                          <span>
                            {customerReceived
                              ? 'Customer Confirmed Receipt · Ready for Final Completion'
                              : `${order.status} · Awaiting Customer Receipt`}
                          </span>
                        </span>
                      ) : (
                        <StatusText status={order.status} />
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-1.5">
                      Customer: <strong className="text-slate-800">{order.customer_name}</strong> ·{' '}
                      <span className="font-mono">{order.customer_phone}</span> ·{' '}
                      {order.fulfillment_method === 'delivery'
                        ? `Delivery to ${order.delivery_address}`
                        : 'Warehouse Collection'}{' '}
                      · Placed {formatDateTime(order.created_at)}
                      {customerReceived && order.customer_confirmed_at && (
                        <>
                          {' · '}
                          <span className="text-[#15803D] font-semibold">
                            Customer clicked Received {formatDateTime(order.customer_confirmed_at)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-base font-bold text-[#0B1F3A] tabular-nums">
                      {formatMoney(order.total_amount)}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        !locked && customerReceived ? 'text-[#15803D]' : 'text-slate-500'
                      }`}
                    >
                      {order.sale_processed
                        ? 'Sale & stock processed'
                        : customerReceived
                          ? 'Receipt confirmed — ready to finalize'
                          : 'Pending customer receipt & completion'}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-200/70 text-xs">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="py-2 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-semibold text-[#0B1F3A]">{item.product_name}</span>
                        <span className="mx-2 text-slate-300">·</span>
                        <span className="font-mono text-[#9E7220] font-semibold">
                          Seller {item.storage_id}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-slate-700">
                        {item.quantity} {item.unit_label} × {formatMoney(item.unit_price)} ={' '}
                        <strong className="text-[#0B1F3A]">{formatMoney(item.subtotal)}</strong>
                      </div>
                    </div>
                  ))}
                </div>

                {!locked && (
                  <div className="pt-3 border-t border-slate-200/80 flex flex-wrap items-center justify-end gap-2">
                    {order.status === 'Pending Confirmation' && (
                      <button
                        type="button"
                        onClick={() => void updateStatus(order.order_reference, 'Confirmed')}
                        className="px-3 py-1.5 text-xs font-semibold border border-slate-300 bg-white rounded-lg text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
                      >
                        Confirm Order
                      </button>
                    )}
                    {order.fulfillment_method === 'warehouse_collection' &&
                      order.status !== 'Ready for Collection' && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateStatus(order.order_reference, 'Ready for Collection')
                          }
                          className="px-3 py-1.5 text-xs font-semibold border border-slate-300 bg-white rounded-lg text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
                        >
                          Ready for Collection
                        </button>
                      )}
                    {order.fulfillment_method === 'delivery' &&
                      order.status !== 'Out for Delivery' && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateStatus(order.order_reference, 'Out for Delivery')
                          }
                          className="px-3 py-1.5 text-xs font-semibold border border-slate-300 bg-white rounded-lg text-[#0B1F3A] hover:bg-slate-50 cursor-pointer"
                        >
                          Out for Delivery
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => void updateStatus(order.order_reference, 'Completed')}
                      className={`px-3.5 py-1.5 text-xs font-semibold text-white rounded-lg cursor-pointer transition-colors duration-300 ${
                        customerReceived
                          ? 'bg-[#15803D] hover:bg-[#166534]'
                          : 'bg-[#0B1F3A] hover:bg-[#142E52]'
                      }`}
                    >
                      Mark Completed & Record Sale
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateStatus(order.order_reference, 'Cancelled')}
                      className="px-3 py-1.5 text-xs font-semibold border border-red-200 bg-white text-[#B91C1C] rounded-lg hover:bg-red-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ========================
// 5. MEMBERS ASSISTANCE DIRECTORY
// ========================
export function MembersDirectoryPanel() {
  const [members, setMembers] = useState<
    Array<{
      id: number;
      storage_id: string;
      business_name: string;
      allocated_space_sqm: number;
      occupied_space_sqm: number;
      monthly_rental_fee: number;
      full_name: string;
      email: string;
      phone: string;
      active_products: number;
    }>
  >([]);

  useEffect(() => {
    void apiFetch<{ members: typeof members }>('/api/operations/members').then((res) =>
      setMembers(res.members)
    );
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
          Approved Warehouse Members
        </h1>
        <p className="text-sm text-slate-500">
          Member directory for operational assistance and storage bay verification.
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-6 font-medium">Storage ID</th>
                <th className="py-3 px-4 font-medium">Business & Owner</th>
                <th className="py-3 px-4 font-medium">Contact</th>
                <th className="py-3 px-4 font-medium text-right">Space (Used / Alloc)</th>
                <th className="py-3 px-4 font-medium text-right">Rental Fee</th>
                <th className="py-3 px-6 font-medium text-right">Active Listings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-6 font-mono font-bold text-[#9E7220]">{m.storage_id}</td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-[#0B1F3A]">{m.business_name}</div>
                    <div className="text-xs text-slate-500">{m.full_name}</div>
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-600">
                    <div>{m.email}</div>
                    <div className="font-mono">{m.phone}</div>
                  </td>
                  <td className="py-3.5 px-4 font-mono tabular-nums text-right text-xs">
                    {m.occupied_space_sqm} / {m.allocated_space_sqm} sqm
                  </td>
                  <td className="py-3.5 px-4 font-mono tabular-nums text-right text-xs">
                    {formatMoney(m.monthly_rental_fee)}
                  </td>
                  <td className="py-3.5 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                    {m.active_products}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ========================
// 6. OPERATIONAL REPORTS PANEL
// ========================
export function OperationalReportsPanel() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{
    sales_summary: { transaction_count: number; units_sold: number; total_revenue: number };
    by_storage: Array<{ storage_id: string; units_sold: number; revenue: number; transactions: number }>;
    order_breakdown: Array<{ status: string; count: number; value: number }>;
    storage_utilization: { total_allocated: number; total_occupied: number; approved_members: number };
  } | null>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await apiFetch<typeof data>(`/api/operations/reports?${qs.toString()}`);
    setData(res);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">Operational Reports</h1>
          <p className="text-sm text-slate-500">
            Completed sales, order statuses, and warehouse bay utilization
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="px-3.5 py-1.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            Filter
          </button>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Completed Sales Revenue</div>
              <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                {formatMoney(data.sales_summary.total_revenue)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Units Sold</div>
              <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                {data.sales_summary.units_sold}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Warehouse Utilization</div>
              <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                {Math.round(
                  (data.storage_utilization.total_occupied /
                    Math.max(1, data.storage_utilization.total_allocated)) *
                    100
                )}
                %
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Approved Members</div>
              <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                {data.storage_utilization.approved_members}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                  Sales by Storage ID
                </h2>
              </div>
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-6 font-medium">Storage ID</th>
                    <th className="py-3 px-4 font-medium text-right">Units</th>
                    <th className="py-3 px-6 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.by_storage.map((s) => (
                    <tr key={s.storage_id}>
                      <td className="py-3 px-6 font-mono font-bold text-[#9E7220]">
                        {s.storage_id}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right">{s.units_sold}</td>
                      <td className="py-3 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                        {formatMoney(s.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                  Orders by Status
                </h2>
              </div>
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-6 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Orders</th>
                    <th className="py-3 px-6 font-medium text-right">Total Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.order_breakdown.map((o) => (
                    <tr key={o.status}>
                      <td className="py-3 px-6">
                        <StatusText status={o.status} />
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right">{o.count}</td>
                      <td className="py-3 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                        {formatMoney(o.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
