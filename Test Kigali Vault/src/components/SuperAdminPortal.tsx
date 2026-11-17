import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Boxes,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  apiFetch,
  downloadCsv,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatTimeShort,
} from '../lib/api.ts';
import type {
  AuditLogEntry,
  AuthUser,
  HeroSlide,
  PopupBannerConfig,
  PopupDisplayFrequency,
  PopupInteractionTarget,
  PopupTriggerType,
} from '../types.ts';
import {
  InventoryManagementPanel,
  OrdersFulfillmentPanel,
  StorageApplicationsPanel,
  StorageRequestsPanel,
} from './OperationsWorkspace.tsx';
import { BrandLogo } from './BrandLogo.tsx';
import { PopupBannerCard, PopupBannerModal } from './PopupBannerModal.tsx';
import { ProductImage } from './ProductImage.tsx';
import { StatusText } from './StatusText.tsx';

interface SuperAdminPortalProps {
  authUser: AuthUser;
  onGoToMarketplace: () => void;
  onLogout: () => void;
}

type AdminSection =
  | 'overview'
  | 'staff'
  | 'members'
  | 'inventory'
  | 'orders'
  | 'slideshow'
  | 'reports'
  | 'audit'
  | 'settings';

interface StaffRecord {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  status: 'active' | 'deactivated' | 'suspended';
  staff_code: string;
  title: string;
  can_manage_storage: boolean;
  can_manage_inventory: boolean;
  can_manage_orders: boolean;
  can_view_reports: boolean;
  can_assist_members: boolean;
  activity_count: number;
  created_at: string;
}

export function SuperAdminPortal({
  authUser,
  onGoToMarketplace,
  onLogout,
}: SuperAdminPortalProps) {
  const [section, setSection] = useState<AdminSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Overview state
  const [overview, setOverview] = useState<{
    revenue: { completed_sales_count: number; total_revenue: number; units_sold: number };
    orders: { total_orders: number; active_orders: number; completed_orders: number };
    storage: {
      approved_members: number;
      total_allocated_sqm: number;
      total_occupied_sqm: number;
      monthly_rental_revenue: number;
    };
    pending_applications: number;
    pending_storage_requests: number;
    staff: { total_staff: number; active_staff: number };
    active_listings: number;
    recent_audit: AuditLogEntry[];
  } | null>(null);

  // Staff state
  const [staffList, setStaffList] = useState<StaffRecord[]>([]);
  const [createStaffOpen, setCreateStaffOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [newStaffTitle, setNewStaffTitle] = useState('Warehouse Associate');
  const [newStaffPass, setNewStaffPass] = useState('');
  const [newPerms, setNewPerms] = useState({
    can_manage_storage: false,
    can_manage_inventory: false,
    can_manage_orders: false,
    can_view_reports: true,
    can_assist_members: true,
  });
  const [staffFeedback, setStaffFeedback] = useState<string | null>(null);

  // Super Admin own account & auto-generated credential reset
  const [adminAccount, setAdminAccount] = useState({
    full_name: authUser.full_name,
    email: authUser.email,
    phone: authUser.phone,
  });
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminName, setAdminName] = useState(authUser.full_name);
  const [adminEmail, setAdminEmail] = useState(authUser.email);
  const [adminPhone, setAdminPhone] = useState(authUser.phone);
  const [generatedAdminPass, setGeneratedAdminPass] = useState<string | null>(null);
  const [copiedAdminPass, setCopiedAdminPass] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);

  // Regular staff Edit Details modal (with manual password input)
  const [editingStaff, setEditingStaff] = useState<StaffRecord | null>(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffTitle, setEditStaffTitle] = useState('');
  const [editStaffEmail, setEditStaffEmail] = useState('');
  const [editStaffPhone, setEditStaffPhone] = useState('');
  const [editStaffPassword, setEditStaffPassword] = useState('');
  const [showEditStaffPassword, setShowEditStaffPassword] = useState(false);
  const [editStaffPerms, setEditStaffPerms] = useState({
    can_manage_storage: false,
    can_manage_inventory: false,
    can_manage_orders: false,
    can_view_reports: false,
    can_assist_members: false,
  });
  const [editStaffSaving, setEditStaffSaving] = useState(false);

  // Members & Storage sub-tabs
  const [membersSubTab, setMembersSubTab] = useState<'all' | 'applications' | 'requests'>('all');
  const [allMembers, setAllMembers] = useState<
    Array<{
      id: number;
      business_name: string;
      storage_id: string | null;
      application_status: string;
      requested_space_sqm: number;
      allocated_space_sqm: number;
      occupied_space_sqm: number;
      monthly_rental_fee: number;
      full_name: string;
      email: string;
      phone: string;
      user_status: string;
      total_sales_revenue: number;
      active_listings: number;
    }>
  >([]);
  const [adjustMember, setAdjustMember] = useState<(typeof allMembers)[0] | null>(null);
  const [adjSpace, setAdjSpace] = useState('');
  const [adjFee, setAdjFee] = useState('');
  const [adjNote, setAdjNote] = useState('');

  // Orders & Sales sub-tabs
  const [ordersSubTab, setOrdersSubTab] = useState<'orders' | 'sales'>('orders');
  const [salesLedger, setSalesLedger] = useState<
    Array<{
      id: number;
      order_reference: string;
      storage_id: string;
      product_name: string;
      quantity_sold: number;
      unit_price: number;
      total_amount: number;
      confirmed_by_label: string;
      created_at: string;
    }>
  >([]);

  // Reports
  const [repFrom, setRepFrom] = useState('');
  const [repTo, setRepTo] = useState('');
  const [reports, setReports] = useState<{
    by_category: Array<{ category: string; units_sold: number; revenue: number }>;
    by_member: Array<{
      storage_id: string;
      business_name: string;
      allocated_space_sqm: number;
      occupied_space_sqm: number;
      units_sold: number;
      revenue: number;
    }>;
    staff_activity: Array<{
      staff_code: string;
      full_name: string;
      title: string;
      status: string;
      actions_logged: number;
    }>;
  } | null>(null);

  // Audit Log
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditRoleFilter, setAuditRoleFilter] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');

  // Settings & Announcements
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annMessage, setAnnMessage] = useState('');
  const [annTarget, setAnnTarget] = useState('ALL');
  const [annSent, setAnnSent] = useState<string | null>(null);

  // Marketplace Slideshow Manager
  const DEFAULT_LOCATION = 'Plot 42, Kigali Special Economic Zone, Masoro';
  const DEFAULT_DISPATCH =
    'Same-day warehouse collection or scheduled Kigali dispatch · Free delivery above 250,000 RWF';
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [slideAutoplay, setSlideAutoplay] = useState(true);
  const [slideIntervalMs, setSlideIntervalMs] = useState(5500);
  const [slideFeedback, setSlideFeedback] = useState<string | null>(null);
  const [slideUploading, setSlideUploading] = useState(false);
  const [editingSlide, setEditingSlide] = useState<HeroSlide | null>(null);
  const [newSlideMediaUrl, setNewSlideMediaUrl] = useState(
    '/src/assets/images/hero_warehouse_vault_1794824614591.jpg'
  );
  const [newSlideMediaType, setNewSlideMediaType] = useState<'image' | 'video'>('image');
  const [newSlideHeadline, setNewSlideHeadline] = useState('');
  const [newSlideLocation, setNewSlideLocation] = useState(DEFAULT_LOCATION);
  const [newSlideDispatch, setNewSlideDispatch] = useState(DEFAULT_DISPATCH);

  // Homepage Multi-Popup Banner & Trigger Rules Manager
  const createDefaultPopupForm = (): PopupBannerConfig => ({
    title: '',
    is_enabled: true,
    image_url: '/src/assets/images/hero_warehouse_vault_1794824614591.jpg',
    headline: 'Welcome to Kigali Vault',
    description:
      'Browse verified Kigali commercial warehouse inventory with same-day Masoro collection and scheduled dispatch.',
    cta_label: 'Explore Marketplace',
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
  });
  const [popupBanners, setPopupBanners] = useState<PopupBannerConfig[]>([]);
  const [editingPopupId, setEditingPopupId] = useState<number | null>(null);
  const [popupForm, setPopupForm] = useState<PopupBannerConfig>(createDefaultPopupForm);
  const [popupUploading, setPopupUploading] = useState(false);
  const [popupSaving, setPopupSaving] = useState(false);
  const [popupFeedback, setPopupFeedback] = useState<string | null>(null);
  const [previewPopupModal, setPreviewPopupModal] = useState<PopupBannerConfig | null>(null);

  const loadOverview = async () => {
    const res = await apiFetch<typeof overview>('/api/admin/overview');
    setOverview(res);
  };

  const loadStaff = async () => {
    const [staffRes, acctRes] = await Promise.all([
      apiFetch<{ staff: StaffRecord[] }>('/api/admin/staff'),
      apiFetch<{ account: { full_name: string; email: string; phone: string } }>('/api/admin/account'),
    ]);
    setStaffList(staffRes.staff);
    setAdminAccount(acctRes.account);
  };

  const loadMembers = async () => {
    const res = await apiFetch<{ members: typeof allMembers }>('/api/admin/members');
    setAllMembers(res.members);
  };

  const loadSales = async () => {
    const res = await apiFetch<{ sales: typeof salesLedger }>('/api/admin/sales');
    setSalesLedger(res.sales);
  };

  const loadReports = async (from = repFrom, to = repTo) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await apiFetch<typeof reports>(`/api/admin/reports?${qs.toString()}`);
    setReports(res);
  };

  const loadAudit = async (role = auditRoleFilter, search = auditSearch) => {
    const qs = new URLSearchParams();
    if (role !== 'all') qs.set('role', role);
    if (search.trim()) qs.set('search', search.trim());
    const res = await apiFetch<{ logs: AuditLogEntry[] }>(
      `/api/admin/audit-logs?${qs.toString()}`
    );
    setAuditLogs(res.logs);
  };

  const loadSettings = async () => {
    const res = await apiFetch<{ settings: Record<string, string> }>('/api/admin/settings');
    setSettingsForm(res.settings);
  };

  const loadSlides = async () => {
    const res = await apiFetch<{ slides: HeroSlide[]; autoplay: boolean; interval_ms: number }>(
      '/api/admin/slides'
    );
    setSlides(res.slides);
    setSlideAutoplay(res.autoplay);
    setSlideIntervalMs(res.interval_ms);
  };

  const loadPopupBanners = async () => {
    const res = await apiFetch<{ popups: PopupBannerConfig[] }>('/api/admin/popup-banners');
    setPopupBanners(res.popups);
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (section === 'overview') void loadOverview();
    if (section === 'staff') void loadStaff();
    if (section === 'members') void loadMembers();
    if (section === 'orders' && ordersSubTab === 'sales') void loadSales();
    if (section === 'slideshow') {
      void loadSlides();
      void loadPopupBanners();
    }
    if (section === 'reports') void loadReports();
    if (section === 'audit') void loadAudit();
    if (section === 'settings') {
      void loadSettings();
      void loadMembers();
    }
  }, [section, ordersSubTab]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffFeedback(null);
    try {
      const res = await apiFetch<{ staff_code: string }>('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          full_name: newStaffName,
          email: newStaffEmail,
          phone: newStaffPhone,
          title: newStaffTitle,
          password: newStaffPass,
          ...newPerms,
        }),
      });
      setCreateStaffOpen(false);
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPhone('');
      setNewStaffPass('');
      setStaffFeedback(`Created staff account ${res.staff_code} successfully.`);
      await loadStaff();
    } catch (err) {
      setStaffFeedback(err instanceof Error ? err.message : 'Unable to create staff account.');
    }
  };

  const toggleStaffPermission = async (
    staff: StaffRecord,
    permKey:
      | 'can_manage_storage'
      | 'can_manage_inventory'
      | 'can_manage_orders'
      | 'can_view_reports'
      | 'can_assist_members'
  ) => {
    const nextVal = !staff[permKey];
    await apiFetch(`/api/admin/staff/${staff.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [permKey]: nextVal }),
    });
    setStaffFeedback(`Updated ${staff.staff_code} permissions.`);
    await loadStaff();
  };

  const updateStaffStatus = async (
    staff: StaffRecord,
    status: 'active' | 'deactivated' | 'suspended'
  ) => {
    await apiFetch(`/api/admin/staff/${staff.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setStaffFeedback(`${staff.staff_code} status set to ${status}.`);
    await loadStaff();
  };

  const openAdminAccountModal = () => {
    setAdminName(adminAccount.full_name);
    setAdminEmail(adminAccount.email);
    setAdminPhone(adminAccount.phone);
    setGeneratedAdminPass(null);
    setCopiedAdminPass(false);
    setAdminModalOpen(true);
  };

  const handleSaveAdminProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffFeedback(null);
    setAdminSaving(true);
    try {
      const res = await apiFetch<{ account: { full_name: string; email: string; phone: string } }>(
        '/api/admin/account',
        {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: adminName,
            email: adminEmail,
            phone: adminPhone,
          }),
        }
      );
      setAdminAccount(res.account);
      setStaffFeedback('Updated Super Admin account details.');
    } catch (err) {
      setStaffFeedback(err instanceof Error ? err.message : 'Unable to update Super Admin account.');
    } finally {
      setAdminSaving(false);
    }
  };

  const handleGenerateAdminPassword = async () => {
    setStaffFeedback(null);
    setCopiedAdminPass(false);
    setAdminSaving(true);
    try {
      const res = await apiFetch<{ generated_password: string }>('/api/admin/account/reset-password', {
        method: 'POST',
      });
      setGeneratedAdminPass(res.generated_password);
      setStaffFeedback('New system-generated Super Admin password active. Copy and store it securely.');
    } catch (err) {
      setStaffFeedback(err instanceof Error ? err.message : 'Unable to reset Super Admin password.');
    } finally {
      setAdminSaving(false);
    }
  };

  const handleCopyAdminPassword = async () => {
    if (!generatedAdminPass) return;
    try {
      await navigator.clipboard.writeText(generatedAdminPass);
      setCopiedAdminPass(true);
      setTimeout(() => setCopiedAdminPass(false), 2500);
    } catch {
      const el = document.createElement('textarea');
      el.value = generatedAdminPass;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedAdminPass(true);
      setTimeout(() => setCopiedAdminPass(false), 2500);
    }
  };

  const openEditStaffModal = (s: StaffRecord) => {
    setEditingStaff(s);
    setEditStaffName(s.full_name);
    setEditStaffTitle(s.title);
    setEditStaffEmail(s.email);
    setEditStaffPhone(s.phone);
    setEditStaffPassword('');
    setShowEditStaffPassword(false);
    setEditStaffPerms({
      can_manage_storage: s.can_manage_storage,
      can_manage_inventory: s.can_manage_inventory,
      can_manage_orders: s.can_manage_orders,
      can_view_reports: s.can_view_reports,
      can_assist_members: s.can_assist_members,
    });
  };

  const handleSaveEditStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setStaffFeedback(null);
    setEditStaffSaving(true);
    try {
      await apiFetch(`/api/admin/staff/${editingStaff.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: editStaffName,
          title: editStaffTitle,
          email: editStaffEmail,
          phone: editStaffPhone,
          ...(editStaffPassword.trim() ? { password: editStaffPassword.trim() } : {}),
          ...editStaffPerms,
        }),
      });
      const updatedCode = editingStaff.staff_code;
      const changedPwd = Boolean(editStaffPassword.trim());
      setEditingStaff(null);
      setEditStaffPassword('');
      setStaffFeedback(
        `Updated details${changedPwd ? ' and password' : ''} for ${updatedCode}.`
      );
      await loadStaff();
    } catch (err) {
      setStaffFeedback(err instanceof Error ? err.message : 'Unable to update staff details.');
    } finally {
      setEditStaffSaving(false);
    }
  };

  const handleSaveMemberAllocation = async (cancelMembership = false) => {
    if (!adjustMember) return;
    await apiFetch(`/api/admin/members/${adjustMember.id}/allocation`, {
      method: 'POST',
      body: JSON.stringify(
        cancelMembership
          ? { cancel_membership: true, note: adjNote }
          : {
              allocated_space_sqm: Number(adjSpace),
              monthly_rental_fee: Number(adjFee),
              note: adjNote,
            }
      ),
    });
    setAdjustMember(null);
    await loadMembers();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaved(null);
    await apiFetch('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settingsForm),
    });
    setSettingsSaved('System settings saved and logged.');
  };

  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnSent(null);
    await apiFetch('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title: annTitle,
        message: annMessage,
        target_storage_id: annTarget,
      }),
    });
    setAnnTitle('');
    setAnnMessage('');
    setAnnSent('Announcement dispatched to member notification inbox.');
  };

  const handleUploadSlideMedia = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'new' | 'edit'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlideUploading(true);
    setSlideFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read media file.'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ url: string; media_type: 'image' | 'video' }>(
        '/api/admin/upload-media',
        {
          method: 'POST',
          body: JSON.stringify({ data_url: dataUrl, filename: file.name }),
        }
      );
      if (target === 'new') {
        setNewSlideMediaUrl(res.url);
        setNewSlideMediaType(res.media_type);
      } else if (editingSlide) {
        setEditingSlide({ ...editingSlide, media_url: res.url, media_type: res.media_type });
      }
      setSlideFeedback(`Uploaded ${res.media_type} asset ready to save.`);
    } catch (err) {
      setSlideFeedback(err instanceof Error ? err.message : 'Media upload failed.');
    } finally {
      setSlideUploading(false);
    }
  };

  const handleAddSlide = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlideFeedback(null);
    try {
      await apiFetch('/api/admin/slides', {
        method: 'POST',
        body: JSON.stringify({
          media_url: newSlideMediaUrl,
          media_type: newSlideMediaType,
          headline: newSlideHeadline,
          location_text: newSlideLocation,
          dispatch_text: newSlideDispatch,
          is_active: true,
        }),
      });
      setNewSlideHeadline('');
      setNewSlideLocation(DEFAULT_LOCATION);
      setNewSlideDispatch(DEFAULT_DISPATCH);
      setSlideFeedback('New slide added to the Public Marketplace hero carousel.');
      await loadSlides();
    } catch (err) {
      setSlideFeedback(err instanceof Error ? err.message : 'Unable to add slide.');
    }
  };

  const handleSaveEditedSlide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlide) return;
    setSlideFeedback(null);
    await apiFetch(`/api/admin/slides/${editingSlide.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        media_url: editingSlide.media_url,
        media_type: editingSlide.media_type,
        headline: editingSlide.headline,
        location_text: editingSlide.location_text,
        dispatch_text: editingSlide.dispatch_text,
        is_active: editingSlide.is_active,
      }),
    });
    setEditingSlide(null);
    setSlideFeedback('Slide overlay text and media updated.');
    await loadSlides();
  };

  const handleToggleSlideActive = async (slide: HeroSlide) => {
    await apiFetch(`/api/admin/slides/${slide.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !slide.is_active }),
    });
    await loadSlides();
  };

  const handleMoveSlide = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const copy = [...slides];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    setSlides(copy);
    await apiFetch('/api/admin/slides/reorder', {
      method: 'POST',
      body: JSON.stringify({ ordered_ids: copy.map((s) => s.id) }),
    });
    setSlideFeedback('Slideshow display order updated.');
    await loadSlides();
  };

  const handleDeleteSlide = async (slideId: number) => {
    await apiFetch(`/api/admin/slides/${slideId}`, { method: 'DELETE' });
    setSlideFeedback('Slide removed from Marketplace Slideshow.');
    await loadSlides();
  };

  const handleUpdateSlidesConfig = async (autoplay: boolean, intervalMs: number) => {
    setSlideAutoplay(autoplay);
    setSlideIntervalMs(intervalMs);
    await apiFetch('/api/admin/slides-config', {
      method: 'PATCH',
      body: JSON.stringify({ autoplay, interval_ms: intervalMs }),
    });
    setSlideFeedback('Carousel playback configuration saved.');
  };

  const handleUploadPopupImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPopupUploading(true);
    setPopupFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ url: string; media_type: 'image' | 'video' }>(
        '/api/admin/upload-media',
        {
          method: 'POST',
          body: JSON.stringify({ data_url: dataUrl, filename: file.name }),
        }
      );
      if (res.media_type !== 'image') {
        setPopupFeedback('Please upload a JPG, PNG, or WebP promotional image for the popup modal.');
        return;
      }
      setPopupForm((prev) => ({ ...prev, image_url: res.url }));
      setPopupFeedback('Promotional popup image uploaded. Configure layout and trigger rules below.');
    } catch (err) {
      setPopupFeedback(err instanceof Error ? err.message : 'Popup image upload failed.');
    } finally {
      setPopupUploading(false);
    }
  };

  const handleSavePopupBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    setPopupSaving(true);
    setPopupFeedback(null);
    try {
      if (editingPopupId !== null) {
        await apiFetch<{ popup: PopupBannerConfig }>(`/api/admin/popup-banners/${editingPopupId}`, {
          method: 'PATCH',
          body: JSON.stringify(popupForm),
        });
        setPopupFeedback('Popup banner and trigger rules updated.');
      } else {
        await apiFetch<{ popup: PopupBannerConfig }>('/api/admin/popup-banners', {
          method: 'POST',
          body: JSON.stringify(popupForm),
        });
        setPopupFeedback('New promotional popup banner added.');
      }
      setEditingPopupId(null);
      setPopupForm(createDefaultPopupForm());
      await loadPopupBanners();
    } catch (err) {
      setPopupFeedback(err instanceof Error ? err.message : 'Unable to save popup banner.');
    } finally {
      setPopupSaving(false);
    }
  };

  const handleTogglePopupEnabled = async (popup: PopupBannerConfig) => {
    if (!popup.id) return;
    setPopupFeedback(null);
    try {
      await apiFetch(`/api/admin/popup-banners/${popup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_enabled: !popup.is_enabled }),
      });
      await loadPopupBanners();
    } catch (err) {
      setPopupFeedback(err instanceof Error ? err.message : 'Unable to update popup status.');
    }
  };

  const handleMovePopup = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= popupBanners.length) return;
    const copy = [...popupBanners];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    setPopupBanners(copy);
    await apiFetch('/api/admin/popup-banners/reorder', {
      method: 'POST',
      body: JSON.stringify({ ordered_ids: copy.map((p) => p.id) }),
    });
    setPopupFeedback('Popup display priority order updated.');
    await loadPopupBanners();
  };

  const handleDeletePopup = async (popupId: number) => {
    await apiFetch(`/api/admin/popup-banners/${popupId}`, { method: 'DELETE' });
    if (editingPopupId === popupId) {
      setEditingPopupId(null);
      setPopupForm(createDefaultPopupForm());
    }
    setPopupFeedback('Popup banner deleted.');
    await loadPopupBanners();
  };

  const describeTriggerRule = (p: PopupBannerConfig) => {
    if (p.trigger_type === 'delay_seconds') {
      return `After ${p.trigger_delay_seconds}s on page`;
    }
    if (p.trigger_type === 'scroll_percent') {
      return `Scroll ${p.trigger_scroll_percent}% depth`;
    }
    if (p.trigger_type === 'click_count') {
      return `After ${p.trigger_click_threshold} page clicks`;
    }
    if (p.trigger_type === 'interaction_target') {
      const targetNames: Record<PopupInteractionTarget, string> = {
        any: 'Any Interaction',
        category_filter: 'Category Filter Click',
        search_input: 'Search Input Focus',
        product_card: 'Product Card Click',
        cart_button: 'Cart Button Click',
        storage_apply: 'Apply Storage Click',
      };
      return `On ${targetNames[p.trigger_interaction_target]}`;
    }
    return 'First Homepage Visit';
  };

  const describeFrequency = (freq: PopupDisplayFrequency) => {
    if (freq === 'once_per_session') return 'Once per session';
    if (freq === 'every_visit') return 'Every visit';
    return 'Once ever per visitor';
  };

  const navItems: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard },
    { id: 'staff', label: 'Staff & Permissions', icon: ShieldCheck },
    { id: 'members', label: 'Members & Storage', icon: Warehouse },
    { id: 'inventory', label: 'Products & Inventory', icon: Boxes },
    { id: 'orders', label: 'Orders & Sales', icon: ClipboardCheck },
    { id: 'slideshow', label: 'Marketplace Slideshow', icon: Film },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'audit', label: 'Audit & Activity Log', icon: Activity },
    { id: 'settings', label: 'Settings & Notices', icon: Settings },
  ];

  const utilPct = overview
    ? Math.round(
        (overview.storage.total_occupied_sqm /
          Math.max(1, overview.storage.total_allocated_sqm)) *
          100
      )
    : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#061326] text-white shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-white/10">
          <BrandLogo variant="dark" />
        </div>
        <div className="px-6 py-4 border-b border-white/10">
          <div className="text-xs font-mono text-[#C99E44]">SUPER ADMIN</div>
          <div className="text-sm font-semibold text-white mt-0.5">{authUser.full_name}</div>
          <div className="text-xs text-slate-400">System Owner Control</div>
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
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#142E52] text-white border border-[#C99E44]/40'
                    : 'text-slate-300 hover:bg-white/6 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-[#C99E44]' : 'text-slate-400'}`} />
                <span>{item.label}</span>
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
          <div className="w-64 bg-[#061326] text-white flex flex-col h-full">
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
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
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
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${
                      section === item.id ? 'bg-[#142E52] text-white' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
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
              <span className="text-xs text-slate-500">Kigali Vault · Super Admin / </span>
              <span className="text-sm font-semibold text-[#0B1F3A]">
                {navItems.find((n) => n.id === section)?.label}
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

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {/* EXECUTIVE OVERVIEW */}
          {section === 'overview' && overview && (
            <div className="space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                  System Control Overview
                </h1>
                <p className="text-sm text-slate-500">
                  Real-time warehouse occupancy, completed sales revenue, active operations, and audit monitoring
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Completed Sales Revenue</div>
                  <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                    {formatMoney(overview.revenue.total_revenue)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.revenue.completed_sales_count} lines · {overview.revenue.units_sold} units
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Storage Utilization</div>
                  <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                    {utilPct}% ({overview.storage.total_occupied_sqm} / {overview.storage.total_allocated_sqm} sqm)
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.storage.approved_members} active members · {formatMoney(overview.storage.monthly_rental_revenue)}/mo
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Operational Queues</div>
                  <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                    {overview.orders.active_orders} Open Orders
                  </div>
                  <div className="text-xs text-[#9E7220] mt-1 tabular-nums font-medium">
                    {overview.pending_applications} storage apps · {overview.pending_storage_requests} expansions
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Staff & Catalog</div>
                  <div className="font-mono text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                    {overview.staff.active_staff} / {overview.staff.total_staff} Active Staff
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.active_listings} active warehouse listings
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                    Protected System Activity Log
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSection('audit')}
                    className="text-xs font-medium text-[#9E7220] hover:underline cursor-pointer"
                  >
                    View Full Audit Log →
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {overview.recent_audit.map((log) => (
                    <div
                      key={log.id}
                      className="px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-400 shrink-0">
                          {formatTimeShort(log.created_at)}
                        </span>
                        <span className="text-slate-800">{log.details}</span>
                      </div>
                      <span className="font-mono text-xs text-[#9E7220] shrink-0">
                        {log.target_ref}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STAFF & PERMISSIONS */}
          {section === 'staff' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                    Staff Accounts & Granular Permissions
                  </h1>
                  <p className="text-sm text-slate-500">
                    Only Super Admin can create staff accounts, suspend access, or modify operational permissions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateStaffOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer self-start"
                >
                  <UserPlus className="w-4 h-4 text-[#C99E44]" />
                  <span>Create Staff Account</span>
                </button>
              </div>

              {staffFeedback && (
                <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 text-xs font-medium text-[#0B1F3A]">
                  {staffFeedback}
                </div>
              )}

              {/* Super Admin Own Account & System-Generated Credential Control */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#9E7220]">SUPER ADMIN</span>
                    <span className="font-semibold text-[#0B1F3A]">{adminAccount.full_name}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {adminAccount.email} · {adminAccount.phone} · Password resets are exclusively system-generated
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openAdminAccountModal}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white text-[#0B1F3A] text-xs font-semibold rounded-lg hover:border-[#0B1F3A] cursor-pointer self-start sm:self-auto"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#9E7220]" />
                  <span>Edit Account / Reset Password</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 font-medium">Staff Member</th>
                        <th className="py-3 px-3 font-medium text-center">Storage</th>
                        <th className="py-3 px-3 font-medium text-center">Inventory</th>
                        <th className="py-3 px-3 font-medium text-center">Orders</th>
                        <th className="py-3 px-3 font-medium text-center">Reports</th>
                        <th className="py-3 px-3 font-medium text-center">Assist</th>
                        <th className="py-3 px-4 font-medium text-right">Actions</th>
                        <th className="py-3 px-6 font-medium text-right">Account Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {staffList.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/70">
                          <td className="py-3.5 px-6">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[#9E7220]">
                                {s.staff_code}
                              </span>
                              <span className="font-semibold text-[#0B1F3A]">{s.full_name}</span>
                            </div>
                            <div className="text-xs text-slate-500">
                              {s.title} · {s.email}
                            </div>
                          </td>
                          {(
                            [
                              'can_manage_storage',
                              'can_manage_inventory',
                              'can_manage_orders',
                              'can_view_reports',
                              'can_assist_members',
                            ] as const
                          ).map((key) => (
                            <td key={key} className="py-3.5 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={s[key]}
                                onChange={() => void toggleStaffPermission(s, key)}
                                className="w-4 h-4 accent-[#0B1F3A] cursor-pointer"
                                aria-label={`Toggle ${key} for ${s.staff_code}`}
                              />
                            </td>
                          ))}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              <span className="font-mono text-xs tabular-nums text-slate-500">
                                {s.activity_count} logged
                              </span>
                              <button
                                type="button"
                                onClick={() => openEditStaffModal(s)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold border border-slate-300 bg-white text-[#0B1F3A] rounded-md hover:border-[#0B1F3A] cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Edit Details</span>
                              </button>
                            </div>
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <select
                              value={s.status}
                              onChange={(e) =>
                                void updateStaffStatus(
                                  s,
                                  e.target.value as 'active' | 'deactivated' | 'suspended'
                                )
                              }
                              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white font-medium"
                            >
                              <option value="active">Active</option>
                              <option value="suspended">Suspended</option>
                              <option value="deactivated">Deactivated</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Super Admin Account & Auto-Generated Password Modal */}
              {adminModalOpen && (
                <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                          Super Admin Account & Credential Reset
                        </h3>
                        <p className="text-xs text-slate-500">
                          Super Admin passwords are automatically generated by the system (manual input disabled).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAdminModalOpen(false)}
                        className="p-1 text-slate-400 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-6 space-y-5">
                      <form onSubmit={handleSaveAdminProfile} className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={adminName}
                            onChange={(e) => setAdminName(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Email *
                            </label>
                            <input
                              type="email"
                              required
                              value={adminEmail}
                              onChange={(e) => setAdminEmail(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Phone *
                            </label>
                            <input
                              type="tel"
                              required
                              value={adminPhone}
                              onChange={(e) => setAdminPhone(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={adminSaving}
                            className="px-4 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] disabled:opacity-50 cursor-pointer"
                          >
                            Save Account Details
                          </button>
                        </div>
                      </form>

                      <div className="pt-4 border-t border-slate-200 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-[#0B1F3A]">
                              Auto-Generated Credential Reset
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Manual password typing is blocked for Super Admin security.
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={adminSaving}
                            onClick={() => void handleGenerateAdminPassword()}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#9E7220] text-white text-xs font-semibold rounded-lg hover:bg-[#855E17] disabled:opacity-50 cursor-pointer shrink-0"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Generate New Password</span>
                          </button>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            System-Generated Password (Read-Only)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={generatedAdminPass || ''}
                              placeholder="Click 'Generate New Password' to issue a secure password"
                              className="flex-1 px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg text-[#0B1F3A] select-all focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={!generatedAdminPass}
                              onClick={() => void handleCopyAdminPassword()}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white text-[#0B1F3A] text-xs font-semibold rounded-lg hover:border-[#0B1F3A] disabled:opacity-40 cursor-pointer shrink-0"
                            >
                              {copiedAdminPass ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-[#15803D]" />
                                  <span className="text-[#15803D]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy Password</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Regular Staff Edit Details Modal (Manual Password Input Permitted) */}
              {editingStaff && (
                <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                          Edit Details · {editingStaff.staff_code}
                        </h3>
                        <p className="text-xs text-slate-500">
                          Update staff profile, role title, email, permissions, or set a new password manually.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingStaff(null)}
                        className="p-1 text-slate-400 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <form onSubmit={handleSaveEditStaff} className="p-6 overflow-y-auto space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={editStaffName}
                            onChange={(e) => setEditStaffName(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Role Title *
                          </label>
                          <input
                            type="text"
                            required
                            value={editStaffTitle}
                            onChange={(e) => setEditStaffTitle(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Email *
                          </label>
                          <input
                            type="email"
                            required
                            value={editStaffEmail}
                            onChange={(e) => setEditStaffEmail(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Phone
                          </label>
                          <input
                            type="tel"
                            value={editStaffPhone}
                            onChange={(e) => setEditStaffPhone(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          New Password (Optional — leave blank to keep current password)
                        </label>
                        <div className="relative">
                          <input
                            type={showEditStaffPassword ? 'text' : 'password'}
                            minLength={6}
                            value={editStaffPassword}
                            onChange={(e) => setEditStaffPassword(e.target.value)}
                            placeholder="Type new password manually (min 6 characters)"
                            className="w-full px-3 py-2 pr-10 text-sm border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditStaffPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                            aria-label="Toggle password visibility"
                          >
                            {showEditStaffPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
                        <div className="font-semibold text-[#0B1F3A] mb-1">
                          Operational Permissions
                        </div>
                        {(
                          [
                            ['can_manage_storage', 'Manage Storage Applications & Expansion Requests'],
                            ['can_manage_inventory', 'Register Products, Photos, Pricing & Stock'],
                            ['can_manage_orders', 'Process Customer Orders & Confirm Sales'],
                            ['can_view_reports', 'View Operational Reports'],
                            ['can_assist_members', 'Assist Members & View Directory'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editStaffPerms[key]}
                              onChange={(e) =>
                                setEditStaffPerms((prev) => ({ ...prev, [key]: e.target.checked }))
                              }
                              className="w-4 h-4 accent-[#0B1F3A]"
                            />
                            <span className="text-slate-700">{label}</span>
                          </label>
                        ))}
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingStaff(null)}
                          className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={editStaffSaving}
                          className="px-5 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] disabled:opacity-50 cursor-pointer"
                        >
                          {editStaffSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {createStaffOpen && (
                <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                        Create Staff Account
                      </h3>
                      <button
                        type="button"
                        onClick={() => setCreateStaffOpen(false)}
                        className="p-1 text-slate-400 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <form onSubmit={handleCreateStaff} className="p-6 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={newStaffName}
                            onChange={(e) => setNewStaffName(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Role Title *
                          </label>
                          <input
                            type="text"
                            required
                            value={newStaffTitle}
                            onChange={(e) => setNewStaffTitle(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Email *
                          </label>
                          <input
                            type="email"
                            required
                            value={newStaffEmail}
                            onChange={(e) => setNewStaffEmail(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Phone *
                          </label>
                          <input
                            type="tel"
                            required
                            value={newStaffPhone}
                            onChange={(e) => setNewStaffPhone(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Initial Password *
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newStaffPass}
                          onChange={(e) => setNewStaffPass(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div className="border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
                        <div className="font-semibold text-[#0B1F3A] mb-1">
                          Assign Operational Permissions
                        </div>
                        {(
                          [
                            ['can_manage_storage', 'Manage Storage Applications & Expansion Requests'],
                            ['can_manage_inventory', 'Register Products, Photos, Pricing & Stock'],
                            ['can_manage_orders', 'Process Customer Orders & Confirm Sales'],
                            ['can_view_reports', 'View Operational Reports'],
                            ['can_assist_members', 'Assist Members & View Directory'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newPerms[key]}
                              onChange={(e) =>
                                setNewPerms((prev) => ({ ...prev, [key]: e.target.checked }))
                              }
                              className="w-4 h-4 accent-[#0B1F3A]"
                            />
                            <span className="text-slate-700">{label}</span>
                          </label>
                        ))}
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setCreateStaffOpen(false)}
                          className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Create Staff Account
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MEMBERS & STORAGE */}
          {section === 'members' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2 p-1 bg-slate-100 rounded-lg w-fit">
                <button
                  type="button"
                  onClick={() => setMembersSubTab('all')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    membersSubTab === 'all' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-slate-600'
                  }`}
                >
                  All Members ({allMembers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMembersSubTab('applications')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    membersSubTab === 'applications'
                      ? 'bg-white text-[#0B1F3A] shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Storage Applications
                </button>
                <button
                  type="button"
                  onClick={() => setMembersSubTab('requests')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    membersSubTab === 'requests'
                      ? 'bg-white text-[#0B1F3A] shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Additional Storage Requests
                </button>
              </div>

              {membersSubTab === 'all' && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-6 font-medium">Storage ID</th>
                          <th className="py-3 px-4 font-medium">Business & Owner</th>
                          <th className="py-3 px-4 font-medium">Status</th>
                          <th className="py-3 px-4 font-medium text-right">Space (Occ / Alloc)</th>
                          <th className="py-3 px-4 font-medium text-right">Monthly Fee</th>
                          <th className="py-3 px-4 font-medium text-right">Sales Revenue</th>
                          <th className="py-3 px-6 font-medium text-right">Manage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allMembers.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-50/70">
                            <td className="py-3.5 px-6 font-mono font-bold text-[#9E7220]">
                              {m.storage_id || 'Unassigned'}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-[#0B1F3A]">{m.business_name}</div>
                              <div className="text-xs text-slate-500">
                                {m.full_name} · {m.phone}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <StatusText status={m.application_status} />
                            </td>
                            <td className="py-3.5 px-4 font-mono tabular-nums text-right text-xs">
                              {m.occupied_space_sqm} / {m.allocated_space_sqm} sqm
                            </td>
                            <td className="py-3.5 px-4 font-mono tabular-nums text-right text-xs">
                              {formatMoney(m.monthly_rental_fee)}
                            </td>
                            <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                              {formatMoney(m.total_sales_revenue)}
                            </td>
                            <td className="py-3.5 px-6 text-right">
                              {m.application_status === 'approved' && m.storage_id ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdjustMember(m);
                                    setAdjSpace(String(m.allocated_space_sqm));
                                    setAdjFee(String(m.monthly_rental_fee));
                                    setAdjNote('');
                                  }}
                                  className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:border-[#0B1F3A] text-[#0B1F3A] cursor-pointer"
                                >
                                  Adjust
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {membersSubTab === 'applications' && (
                <StorageApplicationsPanel onChanged={loadMembers} />
              )}
              {membersSubTab === 'requests' && <StorageRequestsPanel onChanged={loadMembers} />}

              {adjustMember && (
                <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full overflow-hidden shadow-xl">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                        Manage Allocation · {adjustMember.storage_id}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setAdjustMember(null)}
                        className="p-1 text-slate-400 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-6 space-y-4 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Allocated Space (sqm)
                          </label>
                          <input
                            type="number"
                            value={adjSpace}
                            onChange={(e) => setAdjSpace(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Monthly Fee (RWF)
                          </label>
                          <input
                            type="number"
                            value={adjFee}
                            onChange={(e) => setAdjFee(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Audit Note
                        </label>
                        <input
                          type="text"
                          value={adjNote}
                          onChange={(e) => setAdjNote(e.target.value)}
                          placeholder="Reason for allocation or fee adjustment"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveMemberAllocation(true)}
                          className="px-3 py-2 text-xs font-semibold text-[#B91C1C] border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                        >
                          Cancel Membership (Retire ID)
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveMemberAllocation(false)}
                          className="px-4 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Save Allocation
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* INVENTORY */}
          {section === 'inventory' && <InventoryManagementPanel />}

          {/* ORDERS & SALES */}
          {section === 'orders' && (
            <div className="space-y-6">
              <div className="inline-flex p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setOrdersSubTab('orders')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    ordersSubTab === 'orders'
                      ? 'bg-white text-[#0B1F3A] shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Order Fulfillment Queue
                </button>
                <button
                  type="button"
                  onClick={() => setOrdersSubTab('sales')}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                    ordersSubTab === 'sales'
                      ? 'bg-white text-[#0B1F3A] shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Completed Sales Ledger
                </button>
              </div>

              {ordersSubTab === 'orders' ? (
                <OrdersFulfillmentPanel />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                      Completed Sales Transactions
                    </h2>
                    <button
                      type="button"
                      onClick={() => downloadCsv('kigali_vault_sales_ledger.csv', salesLedger)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:border-[#0B1F3A] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-6 font-medium">Completed Date</th>
                          <th className="py-3 px-4 font-medium">Order Ref</th>
                          <th className="py-3 px-4 font-medium">Storage ID</th>
                          <th className="py-3 px-4 font-medium">Product</th>
                          <th className="py-3 px-4 font-medium text-right">Qty</th>
                          <th className="py-3 px-4 font-medium text-right">Total</th>
                          <th className="py-3 px-6 font-medium">Confirmed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {salesLedger.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-6 font-mono text-xs text-slate-600 whitespace-nowrap">
                              {formatDateTime(s.created_at)}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs font-bold text-[#0B1F3A]">
                              {s.order_reference}
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-[#9E7220]">
                              {s.storage_id}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-800">
                              {s.product_name}
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-right">
                              {s.quantity_sold}
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                              {formatMoney(s.total_amount)}
                            </td>
                            <td className="py-3 px-6 text-xs text-slate-600">
                              {s.confirmed_by_label}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* REPORTS & ANALYTICS */}
          {section === 'reports' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                    System-Wide Reports & Analytics
                  </h1>
                  <p className="text-sm text-slate-500">
                    Category performance, Storage ID revenue, and staff activity summary
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={repFrom}
                    onChange={(e) => setRepFrom(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <input
                    type="date"
                    value={repTo}
                    onChange={(e) => setRepTo(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => void loadReports()}
                    className="px-3.5 py-1.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Filter
                  </button>
                  {reports && (
                    <button
                      type="button"
                      onClick={() => downloadCsv('kigali_vault_member_performance.csv', reports.by_member)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-300 bg-white rounded-lg cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  )}
                </div>
              </div>

              {reports && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-200">
                        <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                          Revenue by Product Category
                        </h2>
                      </div>
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 font-medium">Category</th>
                            <th className="py-3 px-4 font-medium text-right">Units</th>
                            <th className="py-3 px-6 font-medium text-right">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reports.by_category.map((c) => (
                            <tr key={c.category}>
                              <td className="py-3 px-6 font-medium text-[#0B1F3A]">{c.category}</td>
                              <td className="py-3 px-4 font-mono tabular-nums text-right">
                                {c.units_sold}
                              </td>
                              <td className="py-3 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                                {formatMoney(c.revenue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-200">
                        <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                          Staff Activity Performance
                        </h2>
                      </div>
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 font-medium">Staff</th>
                            <th className="py-3 px-4 font-medium">Status</th>
                            <th className="py-3 px-6 font-medium text-right">Logged Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reports.staff_activity.map((s) => (
                            <tr key={s.staff_code}>
                              <td className="py-3 px-6">
                                <div className="font-semibold text-[#0B1F3A]">
                                  <span className="font-mono text-[#9E7220] mr-2">
                                    {s.staff_code}
                                  </span>
                                  {s.full_name}
                                </div>
                                <div className="text-xs text-slate-500">{s.title}</div>
                              </td>
                              <td className="py-3 px-4">
                                <StatusText status={s.status} />
                              </td>
                              <td className="py-3 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                                {s.actions_logged}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                        Member Storage & Revenue Summary
                      </h2>
                    </div>
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-6 font-medium">Storage ID</th>
                          <th className="py-3 px-4 font-medium">Member Entity</th>
                          <th className="py-3 px-4 font-medium text-right">Occupied / Allocated</th>
                          <th className="py-3 px-4 font-medium text-right">Units Sold</th>
                          <th className="py-3 px-6 font-medium text-right">Completed Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reports.by_member.map((m) => (
                          <tr key={m.storage_id}>
                            <td className="py-3 px-6 font-mono font-bold text-[#9E7220]">
                              {m.storage_id}
                            </td>
                            <td className="py-3 px-4 font-medium text-[#0B1F3A]">
                              {m.business_name}
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-right text-xs">
                              {m.occupied_space_sqm} / {m.allocated_space_sqm} sqm
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-right">
                              {m.units_sold}
                            </td>
                            <td className="py-3 px-6 font-mono tabular-nums text-right font-semibold text-[#0B1F3A]">
                              {formatMoney(m.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PROTECTED AUDIT LOG */}
          {section === 'audit' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                    Protected Activity & Audit Log
                  </h1>
                  <p className="text-sm text-slate-500">
                    Immutable chronological record of staff, member, checkout, and admin actions. Staff cannot alter or delete records.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={auditRoleFilter}
                    onChange={(e) => {
                      setAuditRoleFilter(e.target.value);
                      void loadAudit(e.target.value, auditSearch);
                    }}
                    className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">All Roles</option>
                    <option value="staff">Staff Actions</option>
                    <option value="super_admin">Super Admin Actions</option>
                    <option value="member">Member Actions</option>
                    <option value="public">Guest Checkout</option>
                  </select>
                  <input
                    type="search"
                    value={auditSearch}
                    onChange={(e) => {
                      setAuditSearch(e.target.value);
                      void loadAudit(auditRoleFilter, e.target.value);
                    }}
                    placeholder="Search WH-0004, Staff 01, ORD..."
                    className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white w-60"
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 font-medium">Timestamp</th>
                        <th className="py-3 px-4 font-medium">Actor</th>
                        <th className="py-3 px-4 font-medium">Target Ref</th>
                        <th className="py-3 px-6 font-medium">Recorded Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-6 font-mono text-xs text-slate-500 whitespace-nowrap">
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-semibold text-[#0B1F3A]">{log.actor_label}</span>
                            <span className="text-xs text-slate-400 ml-1.5">
                              ({log.actor_role})
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-[#9E7220] whitespace-nowrap">
                            {log.target_ref}
                          </td>
                          <td className="py-3 px-6 text-slate-700">{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SYSTEM SETTINGS & ANNOUNCEMENTS */}
          {section === 'settings' && (
            <div className="space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                  System Settings & Member Announcements
                </h1>
                <p className="text-sm text-slate-500">
                  Configure global warehouse pricing, fulfillment thresholds, and broadcast notices to members.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleSaveSettings}
                  className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                    Facility & Operational Configuration
                  </h2>
                  {settingsSaved && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-[#15803D]">
                      {settingsSaved}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Warehouse Name
                      </label>
                      <input
                        type="text"
                        value={settingsForm.warehouse_name || ''}
                        onChange={(e) =>
                          setSettingsForm((p) => ({ ...p, warehouse_name: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Currency Code
                      </label>
                      <input
                        type="text"
                        value={settingsForm.currency_code || 'RWF'}
                        onChange={(e) =>
                          setSettingsForm((p) => ({ ...p, currency_code: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Monthly Rate per sqm
                      </label>
                      <input
                        type="number"
                        value={settingsForm.base_rate_per_sqm || '1500'}
                        onChange={(e) =>
                          setSettingsForm((p) => ({ ...p, base_rate_per_sqm: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Standard Delivery Fee
                      </label>
                      <input
                        type="number"
                        value={settingsForm.delivery_fee || '5000'}
                        onChange={(e) =>
                          setSettingsForm((p) => ({ ...p, delivery_fee: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Free Delivery Threshold
                      </label>
                      <input
                        type="number"
                        value={settingsForm.free_delivery_threshold || '250000'}
                        onChange={(e) =>
                          setSettingsForm((p) => ({
                            ...p,
                            free_delivery_threshold: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Support Phone
                      </label>
                      <input
                        type="text"
                        value={settingsForm.support_phone || ''}
                        onChange={(e) =>
                          setSettingsForm((p) => ({ ...p, support_phone: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Warehouse Address
                    </label>
                    <input
                      type="text"
                      value={settingsForm.warehouse_address || ''}
                      onChange={(e) =>
                        setSettingsForm((p) => ({ ...p, warehouse_address: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={settingsForm.allow_guest_checkout !== 'false'}
                      onChange={(e) =>
                        setSettingsForm((p) => ({
                          ...p,
                          allow_guest_checkout: e.target.checked ? 'true' : 'false',
                        }))
                      }
                      className="w-4 h-4 accent-[#0B1F3A]"
                    />
                    <span>Allow Guest Checkout on Public Marketplace</span>
                  </label>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                    >
                      Save System Settings
                    </button>
                  </div>
                </form>

                <form
                  onSubmit={handleSendAnnouncement}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-[#9E7220]" />
                    <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                      Send Member Announcement
                    </h2>
                  </div>
                  {annSent && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-[#15803D]">
                      {annSent}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Recipient
                    </label>
                    <select
                      value={annTarget}
                      onChange={(e) => setAnnTarget(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="ALL">All Approved Warehouse Members</option>
                      {allMembers
                        .filter((m) => m.application_status === 'approved' && m.storage_id)
                        .map((m) => (
                          <option key={m.storage_id} value={m.storage_id!}>
                            {m.storage_id} — {m.business_name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
                    <input
                      type="text"
                      required
                      value={annTitle}
                      onChange={(e) => setAnnTitle(e.target.value)}
                      placeholder="e.g. Holiday Loading Bay Schedule"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Message *
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={annMessage}
                      onChange={(e) => setAnnMessage(e.target.value)}
                      placeholder="Operational notice for warehouse members..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                  >
                    Broadcast Notification
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* MARKETPLACE SLIDESHOW / BANNER MANAGER */}
          {section === 'slideshow' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">
                    Marketplace Slideshow &amp; Banner Manager
                  </h1>
                  <p className="text-sm text-slate-500">
                    Upload multiple pictures or videos, reorder or remove slides, and customize each slide&apos;s Banner Text Overlay on the Public Marketplace hero.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-lg px-4 py-2.5">
                  <label className="flex items-center gap-2 text-xs font-medium text-[#0B1F3A] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={slideAutoplay}
                      onChange={(e) =>
                        void handleUpdateSlidesConfig(e.target.checked, slideIntervalMs)
                      }
                      className="w-4 h-4 accent-[#0B1F3A]"
                    />
                    <span>Auto-Advance Carousel</span>
                  </label>
                  <select
                    value={slideIntervalMs}
                    onChange={(e) =>
                      void handleUpdateSlidesConfig(slideAutoplay, Number(e.target.value))
                    }
                    className="px-2.5 py-1 text-xs font-mono border border-slate-300 rounded-md bg-white"
                  >
                    <option value={4000}>4.0s interval</option>
                    <option value={5500}>5.5s interval</option>
                    <option value={8000}>8.0s interval</option>
                    <option value={12000}>12.0s interval</option>
                  </select>
                </div>
              </div>

              {slideFeedback && (
                <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 text-xs font-medium text-[#0B1F3A]">
                  {slideFeedback}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Add New Slide Form */}
                <form
                  onSubmit={handleAddSlide}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4 self-start"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[#9E7220]" />
                    <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                      Add Hero Slide (Picture or Video)
                    </h2>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Upload Picture or Video (JPG, PNG, WebP, MP4, WebM)
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                        <Upload className="w-3.5 h-3.5 text-[#0B1F3A]" />
                        <span>{slideUploading ? 'Uploading...' : 'Upload Media File'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                          onChange={(e) => void handleUploadSlideMedia(e, 'new')}
                          className="hidden"
                        />
                      </label>
                      <select
                        value={newSlideMediaType}
                        onChange={(e) =>
                          setNewSlideMediaType(e.target.value as 'image' | 'video')
                        }
                        className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="image">Picture</option>
                        <option value="video">Video</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Media URL (auto-filled on upload or choose preset)
                    </label>
                    <input
                      type="text"
                      required
                      value={newSlideMediaUrl}
                      onChange={(e) => setNewSlideMediaUrl(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="aspect-[16/9] rounded-lg overflow-hidden border border-slate-200 bg-[#061326] relative">
                    {newSlideMediaType === 'video' ? (
                      <video
                        src={newSlideMediaUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ProductImage
                        src={newSlideMediaUrl}
                        alt="New hero slide preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#061326]/90 via-[#061326]/50 to-transparent p-3 text-white">
                      {newSlideHeadline && (
                        <div className="text-xs font-bold">{newSlideHeadline}</div>
                      )}
                      <div className="text-[10px] font-mono text-[#F8F1E1]">
                        {newSlideLocation}
                      </div>
                      <div className="text-[11px] text-white/90 line-clamp-2">
                        {newSlideDispatch}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="text-xs font-semibold text-[#0B1F3A]">
                      Per-Slide Banner Text Overlay
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Banner Headline (optional)
                      </label>
                      <input
                        type="text"
                        value={newSlideHeadline}
                        onChange={(e) => setNewSlideHeadline(e.target.value)}
                        placeholder="e.g. Masoro Commercial Fulfillment Hub"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Location Line *
                      </label>
                      <input
                        type="text"
                        required
                        value={newSlideLocation}
                        onChange={(e) => setNewSlideLocation(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Dispatch Details *
                      </label>
                      <textarea
                        rows={2}
                        required
                        value={newSlideDispatch}
                        onChange={(e) => setNewSlideDispatch(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={slideUploading}
                    className="w-full py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                  >
                    Add Slide to Carousel
                  </button>
                </form>

                {/* Active Slides List */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <h2 className="font-display text-base font-bold text-[#0B1F3A]">
                        Active Slideshow Sequence ({slides.length})
                      </h2>
                      <span className="text-xs text-slate-500">
                        Top-to-bottom order determines homepage playback
                      </span>
                    </div>

                    {slides.length === 0 ? (
                      <div className="p-10 text-center text-sm text-slate-500">
                        No slides configured yet. Add a picture or video slide on the left.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {slides.map((slide, idx) => (
                          <div
                            key={slide.id}
                            className="p-5 flex flex-col sm:flex-row gap-4 items-start"
                          >
                            <div className="w-full sm:w-44 aspect-[16/9] rounded-lg overflow-hidden border border-slate-200 bg-[#061326] shrink-0">
                              {slide.media_type === 'video' ? (
                                <video
                                  src={slide.media_url}
                                  muted
                                  loop
                                  playsInline
                                  autoPlay
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ProductImage
                                  src={slide.media_url}
                                  alt={slide.headline || `Slide ${idx + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>

                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span className="font-mono font-bold text-[#0B1F3A]">
                                  Slide {String(idx + 1).padStart(2, '0')}
                                </span>
                                <span>·</span>
                                <span className="uppercase font-mono text-[11px] text-[#9E7220]">
                                  {slide.media_type}
                                </span>
                                <span>·</span>
                                <span
                                  className={
                                    slide.is_active
                                      ? 'text-[#15803D] font-semibold'
                                      : 'text-slate-400 font-medium'
                                  }
                                >
                                  {slide.is_active ? 'Visible on Homepage' : 'Hidden'}
                                </span>
                              </div>
                              {slide.headline && (
                                <div className="font-display text-sm font-bold text-[#0B1F3A]">
                                  {slide.headline}
                                </div>
                              )}
                              <div className="text-xs font-mono text-[#9E7220]">
                                {slide.location_text}
                              </div>
                              <div className="text-xs text-slate-600">{slide.dispatch_text}</div>

                              <div className="pt-2 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => void handleMoveSlide(idx, -1)}
                                  className="p-1.5 border border-slate-200 rounded-md text-slate-600 hover:border-[#0B1F3A] disabled:opacity-35 cursor-pointer"
                                  title="Move Up"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === slides.length - 1}
                                  onClick={() => void handleMoveSlide(idx, 1)}
                                  className="p-1.5 border border-slate-200 rounded-md text-slate-600 hover:border-[#0B1F3A] disabled:opacity-35 cursor-pointer"
                                  title="Move Down"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleSlideActive(slide)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:border-[#0B1F3A] cursor-pointer"
                                >
                                  {slide.is_active ? (
                                    <>
                                      <EyeOff className="w-3.5 h-3.5" />
                                      <span>Hide</span>
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Show</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingSlide(slide)}
                                  className="px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-md text-[#0B1F3A] hover:border-[#0B1F3A] cursor-pointer"
                                >
                                  Edit Overlay
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteSlide(slide.id)}
                                  className="p-1.5 border border-red-200 rounded-md text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                                  title="Delete Slide"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Homepage Multi-Popup Banner & Trigger Rules Manager */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#9E7220]" />
                      <h2 className="font-display text-lg font-bold text-[#0B1F3A]">
                        Homepage Popup Banner Manager (Multi-Banner &amp; Trigger Rules)
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Upload and manage multiple promotional popup banners with individual Text Layout Design styles and custom trigger, interaction, and visit frequency rules.
                    </p>
                  </div>
                  <div className="text-xs font-mono text-slate-600 shrink-0">
                    {popupBanners.filter((p) => p.is_enabled).length} Active / {popupBanners.length} Total Popups
                  </div>
                </div>

                {popupFeedback && (
                  <div className="p-3.5 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/50 text-xs font-medium text-[#0B1F3A]">
                    {popupFeedback}
                  </div>
                )}

                <form onSubmit={handleSavePopupBanner} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left: Builder Form */}
                  <div className="lg:col-span-7 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                      <span className="text-xs font-bold text-[#0B1F3A]">
                        {editingPopupId !== null
                          ? `Editing Popup #${editingPopupId}`
                          : 'Create New Promotional Popup'}
                      </span>
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1F3A] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={popupForm.is_enabled}
                            onChange={(e) =>
                              setPopupForm((prev) => ({ ...prev, is_enabled: e.target.checked }))
                            }
                            className="w-4 h-4 accent-[#0B1F3A]"
                          />
                          <span>Enable Popup</span>
                        </label>
                        {editingPopupId !== null && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPopupId(null);
                              setPopupForm(createDefaultPopupForm());
                            }}
                            className="text-xs font-medium text-slate-600 hover:text-[#0B1F3A] underline cursor-pointer"
                          >
                            Cancel Edit
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Internal Label / Campaign Name
                        </label>
                        <input
                          type="text"
                          value={popupForm.title || ''}
                          onChange={(e) =>
                            setPopupForm((prev) => ({ ...prev, title: e.target.value }))
                          }
                          placeholder="e.g. Solar Kit Promo, First-Visit Notice"
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Button Label (optional)
                        </label>
                        <input
                          type="text"
                          value={popupForm.cta_label}
                          onChange={(e) =>
                            setPopupForm((prev) => ({ ...prev, cta_label: e.target.value }))
                          }
                          placeholder="e.g. Explore Marketplace"
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <label className="block text-xs font-semibold text-[#0B1F3A]">
                        1. Promotional Image
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                          <Upload className="w-3.5 h-3.5 text-[#0B1F3A]" />
                          <span>{popupUploading ? 'Uploading Image...' : 'Upload Popup Image'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => void handleUploadPopupImage(e)}
                            className="hidden"
                          />
                        </label>
                        {[
                          {
                            label: 'Masoro Hub',
                            url: '/src/assets/images/hero_warehouse_vault_1794824614591.jpg',
                          },
                          {
                            label: 'Solar Power',
                            url: '/src/assets/images/prod_solar_inverter_1794824634604.jpg',
                          },
                          {
                            label: 'Coffee Lots',
                            url: '/src/assets/images/prod_coffee_beans_1794824641932.jpg',
                          },
                          {
                            label: 'Steel & Rebar',
                            url: '/src/assets/images/prod_steel_rebar_1794824627392.jpg',
                          },
                        ].map((preset) => (
                          <button
                            key={preset.url}
                            type="button"
                            onClick={() =>
                              setPopupForm((prev) => ({ ...prev, image_url: preset.url }))
                            }
                            className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md border cursor-pointer ${
                              popupForm.image_url === preset.url
                                ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                                : 'border-slate-200 text-slate-600 hover:border-[#0B1F3A]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        required
                        value={popupForm.image_url}
                        onChange={(e) =>
                          setPopupForm((prev) => ({ ...prev, image_url: e.target.value }))
                        }
                        placeholder="Image URL or uploaded asset path"
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                      />
                    </div>

                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <label className="block text-xs font-semibold text-[#0B1F3A]">
                        2. Promotional Copy
                      </label>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Headline
                        </label>
                        <input
                          type="text"
                          value={popupForm.headline}
                          onChange={(e) =>
                            setPopupForm((prev) => ({ ...prev, headline: e.target.value }))
                          }
                          placeholder="e.g. Welcome to Kigali Vault"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Description
                        </label>
                        <textarea
                          rows={2}
                          value={popupForm.description}
                          onChange={(e) =>
                            setPopupForm((prev) => ({ ...prev, description: e.target.value }))
                          }
                          placeholder="Promotional message, category announcement, or dispatch offer"
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>

                    {/* Text Layout Design Options */}
                    <div className="space-y-3.5 pt-3 border-t border-slate-100">
                      <div className="text-xs font-semibold text-[#0B1F3A]">
                        3. Text Layout Design Options
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1.5">
                            Overlay Position
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {(
                              [
                                { id: 'bottom', label: 'Bottom' },
                                { id: 'center', label: 'Center' },
                                { id: 'top', label: 'Top' },
                                { id: 'below_image', label: 'Below Image' },
                              ] as const
                            ).map((pos) => (
                              <button
                                key={pos.id}
                                type="button"
                                onClick={() =>
                                  setPopupForm((prev) => ({ ...prev, text_position: pos.id }))
                                }
                                className={`px-2.5 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
                                  popupForm.text_position === pos.id
                                    ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-[#0B1F3A]'
                                }`}
                              >
                                {pos.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1.5">
                            Text Alignment
                          </label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(
                              [
                                { id: 'left', label: 'Left', icon: AlignLeft },
                                { id: 'center', label: 'Center', icon: AlignCenter },
                                { id: 'right', label: 'Right', icon: AlignRight },
                              ] as const
                            ).map((al) => {
                              const Icon = al.icon;
                              return (
                                <button
                                  key={al.id}
                                  type="button"
                                  onClick={() =>
                                    setPopupForm((prev) => ({ ...prev, text_align: al.id }))
                                  }
                                  className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
                                    popupForm.text_align === al.id
                                      ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                                      : 'bg-white text-slate-700 border-slate-200 hover:border-[#0B1F3A]'
                                  }`}
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                  <span>{al.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1.5">
                            Headline &amp; Description Order
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {(
                              [
                                { id: 'headline_first', label: 'Headline First' },
                                { id: 'description_first', label: 'Description First' },
                              ] as const
                            ).map((ord) => (
                              <button
                                key={ord.id}
                                type="button"
                                onClick={() =>
                                  setPopupForm((prev) => ({ ...prev, text_order: ord.id }))
                                }
                                className={`px-2 py-1.5 text-[11px] font-medium rounded-md border cursor-pointer ${
                                  popupForm.text_order === ord.id
                                    ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-[#0B1F3A]'
                                }`}
                              >
                                {ord.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1.5">
                            Text Color
                          </label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(
                              [
                                { id: 'white', label: 'White' },
                                { id: 'navy', label: 'Navy' },
                                { id: 'gold', label: 'Gold' },
                              ] as const
                            ).map((tc) => (
                              <button
                                key={tc.id}
                                type="button"
                                onClick={() =>
                                  setPopupForm((prev) => ({ ...prev, text_color: tc.id }))
                                }
                                className={`px-2 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
                                  popupForm.text_color === tc.id
                                    ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-[#0B1F3A]'
                                }`}
                              >
                                {tc.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1.5">
                          Overlay Backdrop Style
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {(
                            [
                              { id: 'dark_scrim', label: 'Dark Scrim' },
                              { id: 'navy_banner', label: 'Solid Navy' },
                              { id: 'light_card', label: 'Light Card' },
                              { id: 'transparent', label: 'Transparent' },
                            ] as const
                          ).map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() =>
                                setPopupForm((prev) => ({
                                  ...prev,
                                  overlay_style: st.id,
                                  text_color:
                                    st.id === 'light_card' && prev.text_color === 'white'
                                      ? 'navy'
                                      : st.id !== 'light_card' && prev.text_color === 'navy'
                                        ? 'white'
                                        : prev.text_color,
                                }))
                              }
                              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
                                popupForm.overlay_style === st.id
                                  ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                                  : 'bg-white text-slate-700 border-slate-200 hover:border-[#0B1F3A]'
                              }`}
                            >
                              {st.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Custom Trigger & Display Control Rules */}
                    <div className="space-y-3.5 pt-3 border-t border-slate-100">
                      <div className="text-xs font-semibold text-[#0B1F3A]">
                        4. Custom Trigger &amp; Display Control Rules
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            When Should This Popup Trigger?
                          </label>
                          <select
                            value={popupForm.trigger_type}
                            onChange={(e) =>
                              setPopupForm((prev) => ({
                                ...prev,
                                trigger_type: e.target.value as PopupTriggerType,
                              }))
                            }
                            className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                          >
                            <option value="first_visit">Immediate on Homepage Load</option>
                            <option value="delay_seconds">Session Time Delay (Seconds)</option>
                            <option value="scroll_percent">Page Scroll Depth (%)</option>
                            <option value="click_count">Visitor Click Threshold</option>
                            <option value="interaction_target">Specific Page Interaction</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Visit Display Frequency
                          </label>
                          <select
                            value={popupForm.display_frequency}
                            onChange={(e) =>
                              setPopupForm((prev) => ({
                                ...prev,
                                display_frequency: e.target.value as PopupDisplayFrequency,
                              }))
                            }
                            className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                          >
                            <option value="once_ever">Once Ever (First Time Visitor)</option>
                            <option value="once_per_session">Once Per Browser Session</option>
                            <option value="every_visit">Every Homepage Visit</option>
                          </select>
                        </div>
                      </div>

                      {popupForm.trigger_type === 'delay_seconds' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Delay Duration (Seconds after visitor lands on homepage)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={300}
                            value={popupForm.trigger_delay_seconds}
                            onChange={(e) =>
                              setPopupForm((prev) => ({
                                ...prev,
                                trigger_delay_seconds: Math.max(1, Number(e.target.value) || 1),
                              }))
                            }
                            className="w-40 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                      )}

                      {popupForm.trigger_type === 'scroll_percent' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Scroll Depth Threshold ({popupForm.trigger_scroll_percent}% of page height)
                          </label>
                          <input
                            type="range"
                            min={10}
                            max={90}
                            step={5}
                            value={popupForm.trigger_scroll_percent}
                            onChange={(e) =>
                              setPopupForm((prev) => ({
                                ...prev,
                                trigger_scroll_percent: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-[#0B1F3A]"
                          />
                        </div>
                      )}

                      {popupForm.trigger_type === 'click_count' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Number of Clicks Before Triggering
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={popupForm.trigger_click_threshold}
                            onChange={(e) =>
                              setPopupForm((prev) => ({
                                ...prev,
                                trigger_click_threshold: Math.max(1, Number(e.target.value) || 1),
                              }))
                            }
                            className="w-40 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                      )}

                      {popupForm.trigger_type === 'interaction_target' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Targeted Marketplace Interaction
                          </label>
                          <select
                            value={popupForm.trigger_interaction_target}
                            onChange={(e) =>
                              setPopupForm((prev) => ({
                                ...prev,
                                trigger_interaction_target: e.target.value as PopupInteractionTarget,
                              }))
                            }
                            className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                          >
                            <option value="any">Any Marketplace Click / Interaction</option>
                            <option value="category_filter">Category Filter Button Click</option>
                            <option value="search_input">Catalog Search Box Interaction</option>
                            <option value="product_card">Product Card Click</option>
                            <option value="cart_button">Shopping Cart Drawer Click</option>
                            <option value="storage_apply">Apply for Warehouse Storage Click</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={popupSaving || popupUploading}
                        className="px-5 py-2.5 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg hover:bg-[#142E52] disabled:opacity-60 cursor-pointer"
                      >
                        {popupSaving
                          ? 'Saving Popup...'
                          : editingPopupId !== null
                            ? 'Save Popup Changes'
                            : 'Add Popup Banner'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewPopupModal(popupForm)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-slate-300 text-[#0B1F3A] text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview Full Modal</span>
                      </button>
                    </div>
                  </div>

                  {/* Right: Live Layout Preview */}
                  <div className="lg:col-span-5 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#0B1F3A]">Live Popup Design Preview</span>
                      <span
                        className={`font-medium ${
                          popupForm.is_enabled ? 'text-[#15803D]' : 'text-slate-500'
                        }`}
                      >
                        {popupForm.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <PopupBannerCard popup={popupForm} compact />
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1">
                      <div>
                        <span className="font-semibold text-[#0B1F3A]">Trigger Rule:</span>{' '}
                        {describeTriggerRule(popupForm)}
                      </div>
                      <div>
                        <span className="font-semibold text-[#0B1F3A]">Frequency:</span>{' '}
                        {describeFrequency(popupForm.display_frequency)}
                      </div>
                    </div>
                  </div>
                </form>

                {/* Configured Popups Queue */}
                <div className="pt-5 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold text-[#0B1F3A]">
                      Configured Popup Banners &amp; Trigger Priority ({popupBanners.length})
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      Higher-listed active popups trigger first when multiple rules match.
                    </span>
                  </div>

                  {popupBanners.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No promotional popup banners uploaded yet. Use the form above to add your first popup.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {popupBanners.map((p, idx) => (
                        <div
                          key={p.id ?? idx}
                          className={`border rounded-xl p-4 flex flex-col sm:flex-row gap-4 items-start ${
                            editingPopupId === p.id
                              ? 'border-[#C99E44] bg-[#FDFBF4]/60'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="w-full sm:w-40 aspect-[16/10] rounded-lg overflow-hidden bg-[#061326] shrink-0 border border-slate-200">
                            <ProductImage
                              src={p.image_url}
                              alt={p.title || p.headline || 'Popup thumbnail'}
                              className="w-full h-full object-cover"
                            />
                          </div>

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-bold text-[#0B1F3A]">
                                Popup {String(idx + 1).padStart(2, '0')}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="font-semibold text-[#0B1F3A] truncate">
                                {p.title || p.headline || 'Untitled Popup'}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span
                                className={
                                  p.is_enabled
                                    ? 'text-[#15803D] font-semibold'
                                    : 'text-slate-400 font-medium'
                                }
                              >
                                {p.is_enabled ? 'Active' : 'Paused'}
                              </span>
                            </div>

                            {p.headline && (
                              <div className="text-xs font-medium text-slate-800 truncate">
                                {p.headline}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                              <span>
                                Trigger:{' '}
                                <strong className="text-[#9E7220]">
                                  {describeTriggerRule(p)}
                                </strong>
                              </span>
                              <span>
                                Frequency:{' '}
                                <strong className="text-[#0B1F3A]">
                                  {describeFrequency(p.display_frequency)}
                                </strong>
                              </span>
                              <span>
                                Layout:{' '}
                                <span className="font-mono">
                                  {p.text_position}/{p.text_align}/{p.overlay_style}
                                </span>
                              </span>
                            </div>

                            <div className="pt-1.5 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => void handleMovePopup(idx, -1)}
                                className="p-1.5 border border-slate-200 rounded-md text-slate-600 hover:border-[#0B1F3A] disabled:opacity-35 cursor-pointer"
                                title="Move Up"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === popupBanners.length - 1}
                                onClick={() => void handleMovePopup(idx, 1)}
                                className="p-1.5 border border-slate-200 rounded-md text-slate-600 hover:border-[#0B1F3A] disabled:opacity-35 cursor-pointer"
                                title="Move Down"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleTogglePopupEnabled(p)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:border-[#0B1F3A] cursor-pointer"
                              >
                                {p.is_enabled ? (
                                  <>
                                    <EyeOff className="w-3.5 h-3.5" />
                                    <span>Pause</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Enable</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreviewPopupModal(p)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:border-[#0B1F3A] cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Preview</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPopupId(p.id ?? null);
                                  setPopupForm({ ...p });
                                  setPopupFeedback(null);
                                }}
                                className="px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-md text-[#0B1F3A] hover:border-[#0B1F3A] cursor-pointer"
                              >
                                Edit Design &amp; Rules
                              </button>
                              {p.id !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeletePopup(p.id!)}
                                  className="p-1.5 border border-red-200 rounded-md text-[#B91C1C] hover:bg-red-50 cursor-pointer"
                                  title="Delete Popup"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {previewPopupModal && (
                <PopupBannerModal
                  popup={previewPopupModal}
                  onClose={() => setPreviewPopupModal(null)}
                  onAction={() => setPreviewPopupModal(null)}
                />
              )}

              {/* Edit Slide Modal */}
              {editingSlide && (
                <div className="fixed inset-0 z-50 bg-[#061326]/60 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                        Edit Slide &amp; Banner Text Overlay
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditingSlide(null)}
                        className="p-1 text-slate-400 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <form onSubmit={handleSaveEditedSlide} className="p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                          <Upload className="w-3.5 h-3.5 text-[#0B1F3A]" />
                          <span>Replace Picture / Video</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                            onChange={(e) => void handleUploadSlideMedia(e, 'edit')}
                            className="hidden"
                          />
                        </label>
                        <span className="text-xs font-mono text-slate-500">
                          {editingSlide.media_type}
                        </span>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Banner Headline
                        </label>
                        <input
                          type="text"
                          value={editingSlide.headline}
                          onChange={(e) =>
                            setEditingSlide({ ...editingSlide, headline: e.target.value })
                          }
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Location Line *
                        </label>
                        <input
                          type="text"
                          required
                          value={editingSlide.location_text}
                          onChange={(e) =>
                            setEditingSlide({ ...editingSlide, location_text: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Dispatch Details *
                        </label>
                        <textarea
                          rows={2}
                          required
                          value={editingSlide.dispatch_text}
                          onChange={(e) =>
                            setEditingSlide({ ...editingSlide, dispatch_text: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setEditingSlide(null)}
                          className="px-4 py-2 text-xs border border-slate-200 rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2 bg-[#0B1F3A] text-white text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Save Slide
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
