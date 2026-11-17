import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Lock,
  Menu,
  Minus,
  PackageCheck,
  Pause,
  Play,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, formatDateTime, formatMoney, setStoredToken } from '../lib/api.ts';
import type {
  AuthUser,
  CartItem,
  HeroSlide,
  OrderDetails,
  PopupBannerConfig,
  PopupInteractionTarget,
  ProductCategory,
  PublicListing,
  PublicSettings,
} from '../types.ts';
import { BrandLogo } from './BrandLogo.tsx';
import { PopupBannerModal } from './PopupBannerModal.tsx';
import { ProductImage } from './ProductImage.tsx';
import { StatusText } from './StatusText.tsx';

interface PublicMarketplaceProps {
  authUser: AuthUser | null;
  onAuthenticated: (user: AuthUser) => void;
  onOpenPortal: () => void;
}

interface ActiveGuestOrder {
  order: OrderDetails;
  customer_phone: string;
}

const ACTIVE_ORDERS_KEY = 'mv_active_guest_orders';

const DEFAULT_HERO_SLIDE: HeroSlide = {
  id: 0,
  media_url: '/src/assets/images/hero_warehouse_vault_1794824614591.jpg',
  media_type: 'image',
  headline: 'Masoro Commercial Fulfillment Hub',
  location_text: 'Plot 42, Kigali Special Economic Zone, Masoro',
  dispatch_text:
    'Same-day warehouse collection or scheduled Kigali dispatch · Free delivery above 250,000 RWF',
  sort_order: 1,
};

const DEMO_ACCOUNTS = [
  {
    label: 'Staff 01 · Storage',
    role: 'Storage Applications & Expansions',
    email: 'staff01@meridianvault.rw',
    pass: 'Staff@2026',
    group: 'operations',
  },
  {
    label: 'Staff 02 · Inventory',
    role: 'Product Registration & Stock',
    email: 'staff02@meridianvault.rw',
    pass: 'Staff@2026',
    group: 'operations',
  },
  {
    label: 'Staff 03 · Orders',
    role: 'Order Confirmation & Fulfillment',
    email: 'staff03@meridianvault.rw',
    pass: 'Staff@2026',
    group: 'operations',
  },
  {
    label: 'Member WH-0001',
    role: 'Approved Warehouse Seller',
    email: 'member1@kigalibuild.rw',
    pass: 'Member@2026',
    group: 'member',
  },
  {
    label: 'Member WH-0002',
    role: 'Approved Warehouse Seller',
    email: 'member2@highlandtrade.rw',
    pass: 'Member@2026',
    group: 'member',
  },
];

export function PublicMarketplace({
  authUser,
  onAuthenticated,
  onOpenPortal,
}: PublicMarketplaceProps) {
  const [settings, setSettings] = useState<PublicSettings>({
    warehouse_name: 'Kigali Vault',
    currency_code: 'RWF',
    base_rate_per_sqm: 1500,
    delivery_fee: 5000,
    free_delivery_threshold: 250000,
    warehouse_address: 'Plot 42, Kigali Special Economic Zone, Masoro',
    support_phone: '+250 788 410 900',
    allow_guest_checkout: true,
  });

  const [listings, setListings] = useState<PublicListing[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [slides, setSlides] = useState<HeroSlide[]>([DEFAULT_HERO_SLIDE]);
  const [slideAutoplay, setSlideAutoplay] = useState(true);
  const [slideIntervalMs, setSlideIntervalMs] = useState(5500);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [popupBanners, setPopupBanners] = useState<PopupBannerConfig[]>([]);
  const [popupQueue, setPopupQueue] = useState<PopupBannerConfig[]>([]);
  const shownInViewRef = useRef<Set<number>>(new Set());

  const [loadingListings, setLoadingListings] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('mv_cart');
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [cartNotice, setCartNotice] = useState<string | null>(null);

  // Modals / Drawers
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<PublicListing | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Guest checkout state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<'warehouse_collection' | 'delivery'>(
    'warehouse_collection'
  );
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [orderReceipt, setOrderReceipt] = useState<OrderDetails | null>(null);

  // Order tracking state
  const [trackRef, setTrackRef] = useState('');
  const [trackPhone, setTrackPhone] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackedOrder, setTrackedOrder] = useState<OrderDetails | null>(null);
  const [trackedOrderPhone, setTrackedOrderPhone] = useState('');

  // Persistent unconfirmed guest orders (retained until guest explicitly clicks "Received")
  const [activeGuestOrders, setActiveGuestOrders] = useState<ActiveGuestOrder[]>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_ORDERS_KEY);
      return saved ? (JSON.parse(saved) as ActiveGuestOrder[]) : [];
    } catch {
      return [];
    }
  });
  const [confirmingOrderRef, setConfirmingOrderRef] = useState<string | null>(null);
  const [confirmReceiptError, setConfirmReceiptError] = useState<string | null>(null);
  const [confirmReceiptSuccess, setConfirmReceiptSuccess] = useState<string | null>(null);

  // Login modal state
  const [loginTab, setLoginTab] = useState<'member' | 'staff_admin'>('member');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showDemoHelper, setShowDemoHelper] = useState(false);

  // Member storage application state
  const [regFullName, setRegFullName] = useState('');
  const [regBusinessName, setRegBusinessName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regSpaceSqm, setRegSpaceSqm] = useState('40');
  const [regNotes, setRegNotes] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mv_cart', JSON.stringify(cart));
    } catch {
      // Ignore storage errors
    }
  }, [cart]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify(activeGuestOrders));
    } catch {
      // Ignore storage errors
    }
  }, [activeGuestOrders]);

  const isPopupEligible = (popup: PopupBannerConfig): boolean => {
    if (!popup.is_enabled || !popup.image_url) return false;
    const pid = popup.id ?? 0;
    if (shownInViewRef.current.has(pid)) return false;
    const versionKey = `${pid}_${popup.updated_at || '1'}`;
    try {
      if (popup.display_frequency === 'once_ever') {
        if (localStorage.getItem(`mv_popup_seen_${versionKey}`) === '1') return false;
      } else if (popup.display_frequency === 'once_per_session') {
        if (sessionStorage.getItem(`mv_popup_session_${versionKey}`) === '1') return false;
      }
    } catch {
      // Ignore storage errors
    }
    return true;
  };

  const enqueuePopups = (candidates: PopupBannerConfig[]) => {
    const eligible = candidates.filter((p) => isPopupEligible(p));
    if (eligible.length === 0) return;
    eligible.forEach((p) => {
      if (p.id !== undefined) shownInViewRef.current.add(p.id);
    });
    setPopupQueue((prev) => {
      const existingIds = new Set(prev.map((x) => x.id));
      const additions = eligible.filter((x) => !existingIds.has(x.id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  };

  const loadMarketplaceData = async () => {
    setLoadingListings(true);
    try {
      const [settingsRes, listingsRes, categoriesRes, slidesRes, popupsRes] = await Promise.all([
        apiFetch<PublicSettings>('/api/public/settings'),
        apiFetch<{ listings: PublicListing[] }>('/api/public/listings'),
        apiFetch<{ categories: ProductCategory[] }>('/api/public/categories'),
        apiFetch<{ slides: HeroSlide[]; autoplay: boolean; interval_ms: number }>(
          '/api/public/slides'
        ),
        apiFetch<{ popups: PopupBannerConfig[] }>('/api/public/popup-banners').catch(() => null),
      ]);
      setSettings(settingsRes);
      setListings(listingsRes.listings);
      const dynamicCats = categoriesRes.categories.map((c) => c.name);
      setCategories(['All', ...dynamicCats]);
      if (slidesRes.slides.length > 0) {
        setSlides(slidesRes.slides);
        setActiveSlideIdx(0);
      } else {
        setSlides([DEFAULT_HERO_SLIDE]);
      }
      setSlideAutoplay(slidesRes.autoplay);
      setSlideIntervalMs(slidesRes.interval_ms);

      const loadedPopups = popupsRes?.popups || [];
      setPopupBanners(loadedPopups);
      enqueuePopups(loadedPopups.filter((p) => p.trigger_type === 'first_visit'));
    } catch {
      // Keep graceful empty state
    } finally {
      setLoadingListings(false);
    }
  };

  const markPopupSeen = (popup: PopupBannerConfig) => {
    const pid = popup.id ?? 0;
    const versionKey = `${pid}_${popup.updated_at || '1'}`;
    try {
      if (popup.display_frequency === 'once_ever') {
        localStorage.setItem(`mv_popup_seen_${versionKey}`, '1');
      } else if (popup.display_frequency === 'once_per_session') {
        sessionStorage.setItem(`mv_popup_session_${versionKey}`, '1');
      }
    } catch {
      // Ignore storage errors
    }
  };

  const dismissActivePopup = () => {
    setPopupQueue((prev) => {
      if (prev.length > 0) {
        markPopupSeen(prev[0]);
      }
      return prev.slice(1);
    });
  };

  const handleActivePopupAction = () => {
    dismissActivePopup();
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    void loadMarketplaceData();
  }, []);

  // Multi-Popup Trigger Engine: session delay, scroll depth, click threshold, & interaction targets
  useEffect(() => {
    if (popupBanners.length === 0) return;

    const timers: number[] = [];
    for (const p of popupBanners) {
      if (p.trigger_type === 'delay_seconds') {
        const ms = Math.max(1000, (p.trigger_delay_seconds || 3) * 1000);
        const timerId = window.setTimeout(() => {
          enqueuePopups([p]);
        }, ms);
        timers.push(timerId);
      }
    }

    const handleScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = Math.round((window.scrollY / docHeight) * 100);
      const matched = popupBanners.filter(
        (p) => p.trigger_type === 'scroll_percent' && pct >= (p.trigger_scroll_percent || 40)
      );
      if (matched.length > 0) enqueuePopups(matched);
    };

    let clickCounter = 0;
    const handleDocumentClick = (ev: MouseEvent) => {
      const targetEl = ev.target as HTMLElement | null;
      if (targetEl?.closest('[data-mv-popup-modal="true"]')) return;

      clickCounter += 1;
      const clickMatched = popupBanners.filter(
        (p) => p.trigger_type === 'click_count' && clickCounter >= (p.trigger_click_threshold || 3)
      );
      if (clickMatched.length > 0) enqueuePopups(clickMatched);

      const triggerEl = targetEl?.closest<HTMLElement>('[data-mv-trigger]');
      const hitTarget = triggerEl?.dataset.mvTrigger as PopupInteractionTarget | undefined;
      const interactionMatched = popupBanners.filter((p) => {
        if (p.trigger_type !== 'interaction_target') return false;
        if (p.trigger_interaction_target === 'any') return true;
        return hitTarget === p.trigger_interaction_target;
      });
      if (interactionMatched.length > 0) enqueuePopups(interactionMatched);
    };

    const handleFocusIn = (ev: FocusEvent) => {
      const targetEl = ev.target as HTMLElement | null;
      const triggerEl = targetEl?.closest<HTMLElement>('[data-mv-trigger]');
      const hitTarget = triggerEl?.dataset.mvTrigger as PopupInteractionTarget | undefined;
      if (!hitTarget) return;
      const matched = popupBanners.filter(
        (p) =>
          p.trigger_type === 'interaction_target' &&
          (p.trigger_interaction_target === hitTarget || p.trigger_interaction_target === 'any')
      );
      if (matched.length > 0) enqueuePopups(matched);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [popupBanners]);

  const syncActiveGuestOrders = async () => {
    if (activeGuestOrders.length === 0) return;
    try {
      const updatedList = await Promise.all(
        activeGuestOrders.map(async (entry) => {
          try {
            const res = await apiFetch<{ order: OrderDetails }>('/api/public/orders/track', {
              method: 'POST',
              body: JSON.stringify({
                order_reference: entry.order.order_reference,
                customer_phone: entry.customer_phone,
              }),
            });
            return { order: res.order, customer_phone: entry.customer_phone };
          } catch {
            return entry;
          }
        })
      );
      setActiveGuestOrders(
        updatedList.filter((entry) => entry.order.customer_confirmed_received !== 1)
      );
    } catch {
      // Ignore transient refresh failures
    }
  };

  useEffect(() => {
    if (!cartOpen && !trackModalOpen) return;
    void syncActiveGuestOrders();
    const timer = window.setInterval(() => {
      void syncActiveGuestOrders();
    }, 6000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen, trackModalOpen]);

  useEffect(() => {
    if (!slideAutoplay || carouselPaused || slides.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveSlideIdx((prev) => (prev + 1) % slides.length);
    }, slideIntervalMs);
    return () => window.clearInterval(timer);
  }, [slideAutoplay, carouselPaused, slides.length, slideIntervalMs]);

  const currentSlide = slides[activeSlideIdx % slides.length] || DEFAULT_HERO_SLIDE;

  const filteredListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = listings.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;
      if (inStockOnly && item.available_qty <= 0) return false;
      if (q) {
        const hay = `${item.name} ${item.category} ${item.description} ${item.storage_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'price_asc') {
      return [...list].sort((a, b) => a.price - b.price);
    }
    if (sortBy === 'price_desc') {
      return [...list].sort((a, b) => b.price - a.price);
    }
    return list;
  }, [listings, searchQuery, selectedCategory, inStockOnly, sortBy]);

  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );

  const computedDeliveryFee = useMemo(() => {
    if (fulfillmentMethod !== 'delivery' || cart.length === 0) return 0;
    return cartSubtotal >= settings.free_delivery_threshold ? 0 : settings.delivery_fee;
  }, [fulfillmentMethod, cart.length, cartSubtotal, settings]);

  const cartTotal = cartSubtotal + computedDeliveryFee;

  const addToCart = (listing: PublicListing, qtyToAdd: number) => {
    if (listing.available_qty <= 0) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.listing_token === listing.listing_token);
      if (existing) {
        const nextQty = Math.min(listing.available_qty, existing.quantity + qtyToAdd);
        return prev.map((i) =>
          i.listing_token === listing.listing_token
            ? { ...i, quantity: nextQty, available_qty: listing.available_qty, price: listing.price }
            : i
        );
      }
      return [
        ...prev,
        {
          listing_token: listing.listing_token,
          storage_id: listing.storage_id,
          name: listing.name,
          unit_label: listing.unit_label,
          price: listing.price,
          available_qty: listing.available_qty,
          image_url: listing.image_url,
          quantity: Math.min(listing.available_qty, qtyToAdd),
        },
      ];
    });
    setCartNotice(`Added ${qtyToAdd} ${listing.unit_label} of ${listing.name} (${listing.storage_id})`);
    setTimeout(() => setCartNotice(null), 2600);
  };

  const updateCartQty = (token: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.listing_token !== token) return item;
          const next = item.quantity + delta;
          if (next <= 0) return null;
          return { ...item, quantity: Math.min(item.available_qty, next) };
        })
        .filter((x): x is CartItem => x !== null)
    );
  };

  const removeFromCart = (token: string) => {
    setCart((prev) => prev.filter((item) => item.listing_token !== token));
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);
    setConfirmReceiptError(null);
    setConfirmReceiptSuccess(null);
    setCheckoutSubmitting(true);
    try {
      const submittedPhone = customerPhone.trim();
      const res = await apiFetch<{ order: OrderDetails }>('/api/public/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName,
          customer_phone: submittedPhone,
          fulfillment_method: fulfillmentMethod,
          delivery_address: deliveryAddress,
          items: cart.map((c) => ({
            listing_token: c.listing_token,
            quantity: c.quantity,
          })),
        }),
      });
      setOrderReceipt(res.order);
      setActiveGuestOrders((prev) => [
        { order: res.order, customer_phone: submittedPhone },
        ...prev.filter((o) => o.order.order_reference !== res.order.order_reference),
      ]);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to complete order.');
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  const handleTrackOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackError(null);
    setConfirmReceiptError(null);
    setConfirmReceiptSuccess(null);
    setTrackedOrder(null);
    setTrackLoading(true);
    try {
      const res = await apiFetch<{ order: OrderDetails }>('/api/public/orders/track', {
        method: 'POST',
        body: JSON.stringify({
          order_reference: trackRef,
          customer_phone: trackPhone,
        }),
      });
      setTrackedOrder(res.order);
      setTrackedOrderPhone(trackPhone.trim());
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : 'Order not found.');
    } finally {
      setTrackLoading(false);
    }
  };

  const handleConfirmOrderReceived = async (orderRef: string, phone: string) => {
    setConfirmReceiptError(null);
    setConfirmReceiptSuccess(null);
    setConfirmingOrderRef(orderRef);
    try {
      const res = await apiFetch<{ order: OrderDetails }>(
        `/api/public/orders/${encodeURIComponent(orderRef)}/confirm-received`,
        {
          method: 'POST',
          body: JSON.stringify({ customer_phone: phone }),
        }
      );
      setActiveGuestOrders((prev) =>
        prev.filter((entry) => entry.order.order_reference !== res.order.order_reference)
      );
      if (orderReceipt?.order_reference === res.order.order_reference) {
        setOrderReceipt(null);
      }
      if (trackedOrder?.order_reference === res.order.order_reference) {
        setTrackedOrder(res.order);
      }
      setConfirmReceiptSuccess(
        `Receipt confirmed for ${res.order.order_reference}. Warehouse staff have been notified.`
      );
    } catch (err) {
      setConfirmReceiptError(
        err instanceof Error ? err.message : 'Unable to confirm order receipt.'
      );
    } finally {
      setConfirmingOrderRef(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      if (loginTab === 'member' && res.user.role !== 'member') {
        setLoginError('This account is a Staff or Super Admin account. Use the Staff & Admin tab.');
        setLoginLoading(false);
        return;
      }
      if (loginTab === 'staff_admin' && res.user.role === 'member') {
        setLoginError('This is a Member account. Use the Member Login tab.');
        setLoginLoading(false);
        return;
      }

      setStoredToken(res.token);
      setLoginModalOpen(false);
      onAuthenticated(res.user);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRegisterMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>(
        '/api/auth/register-member',
        {
          method: 'POST',
          body: JSON.stringify({
            full_name: regFullName,
            business_name: regBusinessName,
            email: regEmail,
            phone: regPhone,
            password: regPassword,
            requested_space_sqm: Number(regSpaceSqm),
            notes: regNotes,
          }),
        }
      );
      setStoredToken(res.token);
      setRegisterModalOpen(false);
      onAuthenticated(res.user);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Application submission failed.');
    } finally {
      setRegLoading(false);
    }
  };

  const openTrackWithSample = () => {
    setTrackRef('ORD-2026-1004');
    setTrackPhone('+250 788 554 040');
    setTrackError(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Logo & Wordmark */}
          <a
            href="#top"
            className="whitespace-nowrap shrink-0"
          >
            <BrandLogo variant="light" />
          </a>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#catalog"
              className="hover:text-[#0B1F3A] hover:underline underline-offset-4 whitespace-nowrap shrink-0 transition-colors"
            >
              Catalog
            </a>
            <button
              type="button"
              onClick={() => setTrackModalOpen(true)}
              className="hover:text-[#0B1F3A] hover:underline underline-offset-4 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Track Order
              {activeGuestOrders.length > 0 && (
                <span className="ml-1 font-mono text-xs font-semibold text-[#9E7220]">
                  ({activeGuestOrders.length})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setRegisterModalOpen(true)}
              className="hover:text-[#0B1F3A] hover:underline underline-offset-4 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Storage Access
            </button>
            {authUser ? (
              <button
                type="button"
                onClick={onOpenPortal}
                className="text-[#0B1F3A] font-semibold hover:text-[#9E7220] hover:underline underline-offset-4 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Open Portal
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className="hover:text-[#0B1F3A] hover:underline underline-offset-4 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Portal Login
              </button>
            )}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              data-mv-trigger="cart_button"
              onClick={() => {
                setOrderReceipt(null);
                setCartOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#0B1F3A] text-white rounded-lg hover:bg-[#142E52] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4 text-[#C99E44]" />
              <span>Cart</span>
              <span className="font-mono tabular-nums text-xs text-[#F8F1E1]">
                ({cartItemCount})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile navigation drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-2">
            <a
              href="#catalog"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm font-medium text-slate-700"
            >
              Catalog
            </a>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setTrackModalOpen(true);
              }}
              className="block w-full text-left py-2 text-sm font-medium text-slate-700"
            >
              Track Order
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setRegisterModalOpen(true);
              }}
              className="block w-full text-left py-2 text-sm font-medium text-slate-700"
            >
              Storage Access
            </button>
            {authUser ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenPortal();
                }}
                className="block w-full text-left py-2 text-sm font-semibold text-[#0B1F3A]"
              >
                Open Portal
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setLoginModalOpen(true);
                }}
                className="block w-full text-left py-2 text-sm font-medium text-slate-700"
              >
                Portal Login
              </button>
            )}
          </div>
        )}
      </header>

      {/* Subtle Toast Notification for Cart Additions */}
      {cartNotice && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#0B1F3A] text-white px-4 py-3 rounded-lg shadow-lg border border-[#C99E44]/40 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-4 h-4 text-[#C99E44] shrink-0" />
          <span>{cartNotice}</span>
          <button
            type="button"
            onClick={() => {
              setCartNotice(null);
              setOrderReceipt(null);
              setCartOpen(true);
            }}
            className="text-xs font-semibold text-[#F8F1E1] underline underline-offset-2 whitespace-nowrap cursor-pointer"
          >
            View Cart
          </button>
        </div>
      )}

      {/* Section 1: Storefront Split Hero */}
      <section id="top" className="border-b border-slate-200 bg-[#F8FAFC]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-wider text-[#9E7220] mb-3">
                {settings.warehouse_name} · Verified Commercial Fulfillment
              </p>
              <h1
                className="font-display text-3xl sm:text-4xl lg:text-[44px] font-bold tracking-tight text-[#0B1F3A] leading-[1.12] mb-5"
                style={{ textWrap: 'balance' }}
              >
                Direct Warehouse Inventory, Verified by Storage ID
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
                Purchase construction materials, industrial energy hardware, and wholesale agricultural staples directly from inspected warehouse bays. Every listing is independently stocked and identified solely by its seller Storage ID.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="#catalog"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] transition-colors whitespace-nowrap"
                >
                  <span>Browse Marketplace</span>
                  <ArrowRight className="w-4 h-4 text-[#C99E44]" />
                </a>
                <button
                  type="button"
                  data-mv-trigger="storage_apply"
                  onClick={() => setRegisterModalOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-white border border-slate-300 text-[#0B1F3A] text-sm font-semibold rounded-lg hover:border-[#C99E44] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Warehouse className="w-4 h-4 text-[#9E7220]" />
                  <span>Apply for Warehouse Storage</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-72 sm:h-96 lg:h-full min-h-[360px] rounded-xl overflow-hidden border border-slate-200 bg-[#061326]">
                {currentSlide.media_type === 'video' ? (
                  <video
                    key={currentSlide.id + '-' + currentSlide.media_url}
                    src={currentSlide.media_url}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ProductImage
                    key={currentSlide.id + '-' + currentSlide.media_url}
                    src={currentSlide.media_url}
                    alt={currentSlide.headline || 'Kigali Vault commercial storage facility'}
                    className="w-full h-full object-cover transition-opacity duration-500"
                  />
                )}

                {/* Per-Slide Measured Contrast Scrim & Overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#061326]/90 via-[#061326]/55 to-transparent p-6 text-white">
                  {currentSlide.headline && (
                    <div className="font-display text-lg sm:text-xl font-bold text-white tracking-tight mb-1">
                      {currentSlide.headline}
                    </div>
                  )}
                  <div className="text-xs font-mono text-[#F8F1E1] mb-1">
                    {currentSlide.location_text}
                  </div>
                  <div className="text-sm font-medium text-white/90">
                    {currentSlide.dispatch_text}
                  </div>

                  {slides.length > 1 && (
                    <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-1.5">
                        {slides.map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setActiveSlideIdx(idx)}
                            aria-label={`View slide ${idx + 1}`}
                            className={`h-1.5 rounded-sm transition-all cursor-pointer ${
                              idx === activeSlideIdx
                                ? 'w-7 bg-[#C99E44]'
                                : 'w-3 bg-white/35 hover:bg-white/60'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCarouselPaused((p) => !p)}
                          aria-label={carouselPaused ? 'Resume slideshow' : 'Pause slideshow'}
                          className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                        >
                          {carouselPaused ? (
                            <Play className="w-3.5 h-3.5" />
                          ) : (
                            <Pause className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveSlideIdx((prev) => (prev - 1 + slides.length) % slides.length)
                          }
                          aria-label="Previous slide"
                          className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveSlideIdx((prev) => (prev + 1) % slides.length)}
                          aria-label="Next slide"
                          className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Marketplace Catalog */}
      <section id="catalog" className="flex-1 py-12 lg:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1F3A] tracking-tight">
                Available Warehouse Inventory
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Compare independent listings across storage holders. Seller privacy is strictly protected via Storage IDs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTrackModalOpen(true)}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#0B1F3A] hover:text-[#9E7220] transition-colors whitespace-nowrap self-start md:self-auto cursor-pointer"
            >
              <ClipboardList className="w-4 h-4 text-[#9E7220]" />
              <span>Track Existing Order</span>
            </button>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 mb-8 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  data-mv-trigger="category_filter"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#0B1F3A] text-white'
                      : 'text-slate-600 hover:text-[#0B1F3A]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  data-mv-trigger="search_input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search product or WH-0001..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                />
              </div>

              <button
                type="button"
                onClick={() => setInStockOnly((v) => !v)}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  inStockOnly
                    ? 'bg-[#FDFBF4] border-[#C99E44] text-[#9E7220]'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {inStockOnly ? 'In Stock Only: On' : 'In Stock Only'}
              </button>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'newest' | 'price_asc' | 'price_desc')}
                aria-label="Sort listings"
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-[#0B1F3A]"
              >
                <option value="newest">Sort: Featured</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
              </select>
            </div>
          </div>

          {/* 3-Column Product Grid */}
          {loadingListings ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div
                  key={n}
                  className="border border-slate-200 rounded-xl overflow-hidden animate-pulse"
                >
                  <div className="aspect-[4/3] bg-slate-100" />
                  <div className="p-5 space-y-3">
                    <div className="h-3 w-1/2 bg-slate-100 rounded" />
                    <div className="h-5 w-3/4 bg-slate-100 rounded" />
                    <div className="h-4 w-1/3 bg-slate-100 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="border border-slate-200 rounded-xl p-12 text-center bg-slate-50/50">
              <p className="text-base font-semibold text-[#0B1F3A] mb-1">
                No matching products found
              </p>
              <p className="text-sm text-slate-500 mb-4">
                Try clearing your search filter or switching product categories.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                  setInStockOnly(false);
                }}
                className="px-4 py-2 text-xs font-semibold bg-[#0B1F3A] text-white rounded-lg cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
              {filteredListings.map((item) => {
                const outOfStock = item.available_qty <= 0 || item.status === 'Out of Stock';
                return (
                  <article
                    key={item.listing_token}
                    data-mv-trigger="product_card"
                    className="group border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProduct(item);
                        setDetailQty(1);
                      }}
                      className="aspect-[4/3] w-full bg-slate-100 overflow-hidden text-left cursor-pointer"
                    >
                      <ProductImage
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    </button>

                    <div className="p-5 flex-1 flex flex-col">
                      {/* Clean unboxed metadata (Zero-Pill Rule) */}
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                        <span className="truncate">{item.category}</span>
                        <span className="font-mono font-semibold text-[#9E7220] whitespace-nowrap shrink-0">
                          Seller {item.storage_id}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveProduct(item);
                          setDetailQty(1);
                        }}
                        className="text-left font-display text-base font-semibold text-[#0B1F3A] group-hover:text-[#1E4070] transition-colors mb-2 cursor-pointer"
                      >
                        {item.name}
                      </button>

                      <p className="text-sm text-slate-600 line-clamp-2 mb-4 flex-1">
                        {item.description}
                      </p>

                      <div className="pt-4 border-t border-slate-100 flex items-end justify-between gap-3">
                        <div>
                          <div className="font-mono text-base font-semibold text-[#0B1F3A] tabular-nums">
                            {formatMoney(item.price, settings.currency_code)}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                            {outOfStock ? (
                              <span className="text-[#B91C1C] font-medium">Out of Stock</span>
                            ) : (
                              <span>
                                {item.available_qty} {item.unit_label} available
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveProduct(item);
                              setDetailQty(1);
                            }}
                            className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:border-[#0B1F3A] transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            disabled={outOfStock}
                            onClick={() => addToCart(item, 1)}
                            className="px-3.5 py-2 text-xs font-semibold bg-[#0B1F3A] text-white rounded-lg hover:bg-[#142E52] disabled:bg-slate-200 disabled:text-slate-400 transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
                          >
                            Add to Cart
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Section 3: Warehouse Operations & Portal Access */}
      <section className="border-t border-slate-200 bg-[#0B1F3A] text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7">
            <p className="text-xs font-medium tracking-wider text-[#C99E44] mb-2">
              Managed Commercial Warehousing
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Store Inventory Securely & Sell Under Your Permanent Storage ID
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
              Approved commercial members receive one permanent Storage ID (such as WH-0001) linked to their warehouse allocation. Authorized warehouse staff manage intake photography, stock updates, and order fulfillment while you monitor sales and capacity in real time.
            </p>
          </div>
          <div className="lg:col-span-5 flex flex-wrap lg:justify-end gap-3">
            <button
              type="button"
              onClick={() => setRegisterModalOpen(true)}
              className="px-5 py-3 bg-[#C99E44] text-[#061326] text-sm font-semibold rounded-lg hover:bg-[#d8af56] transition-colors whitespace-nowrap cursor-pointer"
            >
              Request Storage Space
            </button>
            <button
              type="button"
              onClick={() => {
                if (authUser) {
                  onOpenPortal();
                } else {
                  setLoginModalOpen(true);
                }
              }}
              className="px-5 py-3 bg-white/10 border border-white/25 text-white text-sm font-semibold rounded-lg hover:bg-white/15 transition-colors whitespace-nowrap cursor-pointer"
            >
              {authUser ? 'Go to My Portal' : 'Member & Staff Login'}
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <BrandLogo variant="light" compact />
            <span className="mx-1">·</span>
            <span>{settings.warehouse_address}</span>
            <span className="mx-1">·</span>
            <span className="font-mono">{settings.support_phone}</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setTrackModalOpen(true)}
              className="hover:text-[#0B1F3A] cursor-pointer"
            >
              Track Order
            </button>
            <button
              type="button"
              onClick={() => setRegisterModalOpen(true)}
              className="hover:text-[#0B1F3A] cursor-pointer"
            >
              Apply for Storage
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginTab('staff_admin');
                setLoginModalOpen(true);
              }}
              className="hover:text-[#0B1F3A] cursor-pointer"
            >
              Staff & Admin Access
            </button>
          </div>
        </div>
      </footer>

      {/* ================= MODALS & DRAWERS ================= */}

      {/* Product Detail Modal */}
      {activeProduct && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-3xl w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                <span>{activeProduct.category}</span>
                <span className="mx-2">·</span>
                <span className="font-mono font-semibold text-[#9E7220]">
                  Seller {activeProduct.storage_id}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveProduct(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Close product details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-6">
                <div className="aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                  <ProductImage
                    src={activeProduct.image_url}
                    alt={activeProduct.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <div className="md:col-span-6 flex flex-col">
                <h3 className="font-display text-xl font-bold text-[#0B1F3A] mb-2">
                  {activeProduct.name}
                </h3>
                <div className="font-mono text-2xl font-bold text-[#0B1F3A] tabular-nums mb-3">
                  {formatMoney(activeProduct.price, settings.currency_code)}
                  <span className="text-xs font-sans font-normal text-slate-500 ml-2">
                    per {activeProduct.unit_label.replace(/s$/, '')}
                  </span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed mb-5">
                  {activeProduct.description}
                </p>

                <div className="border-t border-b border-slate-200 py-3 mb-5 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Fulfilled By</span>
                    <span className="font-mono font-semibold text-[#0B1F3A]">
                      {activeProduct.storage_id}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Available Stock</span>
                    <span className="font-mono tabular-nums font-medium text-slate-800">
                      {activeProduct.available_qty} {activeProduct.unit_label}
                    </span>
                  </div>
                </div>

                {activeProduct.available_qty > 0 ? (
                  <div className="mt-auto flex items-center gap-3">
                    <div className="inline-flex items-center border border-slate-300 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                        className="p-2.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="px-4 font-mono text-sm font-semibold tabular-nums">
                        {detailQty}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDetailQty((q) => Math.min(activeProduct.available_qty, q + 1))
                        }
                        className="p-2.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        addToCart(activeProduct, detailQty);
                        setActiveProduct(null);
                      }}
                      className="flex-1 py-2.5 px-4 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] transition-colors cursor-pointer"
                    >
                      Add to Cart ·{' '}
                      <span className="font-mono tabular-nums">
                        {formatMoney(activeProduct.price * detailQty, settings.currency_code)}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="mt-auto p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-[#B91C1C]">
                    Currently out of stock for this Storage ID listing.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Over Cart & Guest Checkout Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 backdrop-blur-[2px] flex justify-end">
          <div className="bg-white w-full max-w-lg h-full flex flex-col border-l border-slate-200 shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A]">
                  {orderReceipt ? 'Order Confirmation' : 'Shopping Cart & Guest Checkout'}
                </h3>
                <p className="text-xs text-slate-500">
                  {orderReceipt
                    ? 'Save your Order Reference to track fulfillment status'
                    : 'No account required to complete your order'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Close cart"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {confirmReceiptSuccess && (
                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-[#15803D]">
                  {confirmReceiptSuccess}
                </div>
              )}
              {confirmReceiptError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                  {confirmReceiptError}
                </div>
              )}

              {activeGuestOrders.length > 0 && !orderReceipt && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#0B1F3A]">
                    Active Order{activeGuestOrders.length > 1 ? 's' : ''} · Pending Receipt Confirmation
                  </div>
                  {activeGuestOrders.map(({ order, customer_phone }) => (
                    <div
                      key={order.order_reference}
                      className="p-4 rounded-xl bg-[#FDFBF4] border border-[#C99E44]/50 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] text-slate-500">Order Reference</div>
                          <div className="font-mono text-base font-bold text-[#0B1F3A]">
                            {order.order_reference}
                          </div>
                        </div>
                        <StatusText status={order.status} />
                      </div>
                      <div className="text-xs text-slate-600 flex items-center justify-between">
                        <span>
                          {order.fulfillment_method === 'delivery'
                            ? 'Delivery Dispatch'
                            : 'Warehouse Collection'}
                        </span>
                        <span className="font-mono font-semibold text-[#0B1F3A] tabular-nums">
                          {formatMoney(order.total_amount, settings.currency_code)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        {order.status !== 'Cancelled' && (
                          <button
                            type="button"
                            disabled={confirmingOrderRef === order.order_reference}
                            onClick={() =>
                              void handleConfirmOrderReceived(order.order_reference, customer_phone)
                            }
                            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-[#15803D] text-white text-xs font-semibold rounded-lg hover:bg-[#166534] disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {confirmingOrderRef === order.order_reference
                                ? 'Confirming...'
                                : 'Received'}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setTrackRef(order.order_reference);
                            setTrackPhone(customer_phone);
                            setTrackedOrder(order);
                            setTrackedOrderPhone(customer_phone);
                            setCartOpen(false);
                            setTrackModalOpen(true);
                          }}
                          className="py-2 px-3 border border-slate-300 bg-white text-[#0B1F3A] text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                        >
                          Track Order
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {orderReceipt ? (
                <div className="space-y-6">
                  <div className="p-5 rounded-xl bg-[#FDFBF4] border border-[#C99E44]/50">
                    <div className="flex items-center gap-2 text-[#15803D] font-semibold text-sm mb-2">
                      <PackageCheck className="w-5 h-5" />
                      <span>Order Submitted · Pending Staff Confirmation</span>
                    </div>
                    <div className="text-xs text-slate-600 mb-3">
                      Your Order Reference remains saved here and in Track Order until you click Received after delivery or warehouse collection.
                    </div>
                    <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3">
                      <span className="text-xs text-slate-500">Order Reference</span>
                      <span className="font-mono text-base font-bold text-[#0B1F3A]">
                        {orderReceipt.order_reference}
                      </span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {orderReceipt.items.map((item, idx) => (
                      <div key={idx} className="p-4 flex items-center justify-between gap-3 text-sm">
                        <div>
                          <div className="font-medium text-[#0B1F3A]">{item.product_name}</div>
                          <div className="text-xs text-slate-500">
                            Seller <span className="font-mono">{item.storage_id}</span> ·{' '}
                            <span className="font-mono tabular-nums">
                              {item.quantity} {item.unit_label}
                            </span>{' '}
                            × {formatMoney(item.unit_price, settings.currency_code)}
                          </div>
                        </div>
                        <div className="font-mono font-semibold tabular-nums text-[#0B1F3A]">
                          {formatMoney(item.subtotal, settings.currency_code)}
                        </div>
                      </div>
                    ))}
                    <div className="p-4 bg-slate-50 space-y-1.5 text-sm">
                      <div className="flex justify-between text-slate-600">
                        <span>Fulfillment</span>
                        <span className="font-medium text-[#0B1F3A]">
                          {orderReceipt.fulfillment_method === 'delivery'
                            ? `Delivery (${orderReceipt.delivery_address})`
                            : 'Warehouse Collection'}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Delivery Fee</span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(orderReceipt.delivery_fee, settings.currency_code)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold text-[#0B1F3A] pt-2 border-t border-slate-200">
                        <span>Total Amount</span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(orderReceipt.total_amount, settings.currency_code)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {(() => {
                      const saved = activeGuestOrders.find(
                        (a) => a.order.order_reference === orderReceipt.order_reference
                      );
                      if (!saved) return null;
                      return (
                        <button
                          type="button"
                          disabled={confirmingOrderRef === orderReceipt.order_reference}
                          onClick={() =>
                            void handleConfirmOrderReceived(
                              orderReceipt.order_reference,
                              saved.customer_phone
                            )
                          }
                          className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-[#15803D] text-white text-sm font-semibold rounded-lg hover:bg-[#166534] disabled:opacity-50 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            {confirmingOrderRef === orderReceipt.order_reference
                              ? 'Confirming Receipt...'
                              : 'Received'}
                          </span>
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => {
                        const saved = activeGuestOrders.find(
                          (a) => a.order.order_reference === orderReceipt.order_reference
                        );
                        setTrackRef(orderReceipt.order_reference);
                        if (saved) {
                          setTrackPhone(saved.customer_phone);
                          setTrackedOrderPhone(saved.customer_phone);
                        }
                        setTrackedOrder(orderReceipt);
                        setCartOpen(false);
                        setTrackModalOpen(true);
                      }}
                      className="flex-1 py-2.5 px-4 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                    >
                      Track This Order
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderReceipt(null);
                        setCartOpen(false);
                      }}
                      className="px-4 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Continue Shopping
                    </button>
                  </div>
                </div>
              ) : cart.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-base font-semibold text-[#0B1F3A] mb-1">Your cart is empty</p>
                  <p className="text-sm text-slate-500">
                    Add products from the marketplace catalog to begin guest checkout.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl">
                    {cart.map((item) => (
                      <div key={item.listing_token} className="p-4 flex gap-3.5 items-center">
                        <div className="w-16 h-14 rounded-lg overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                          <ProductImage
                            src={item.image_url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#0B1F3A] truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            Seller <span className="font-mono text-[#9E7220]">{item.storage_id}</span>
                            {' · '}
                            <span className="font-mono tabular-nums">
                              {formatMoney(item.price, settings.currency_code)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <div className="inline-flex items-center border border-slate-200 rounded-md">
                              <button
                                type="button"
                                onClick={() => updateCartQty(item.listing_token, -1)}
                                className="p-1 text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="px-2.5 text-xs font-mono font-semibold tabular-nums">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateCartQty(item.listing_token, 1)}
                                className="p-1 text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFromCart(item.listing_token)}
                              className="p-1 text-slate-400 hover:text-[#B91C1C] cursor-pointer"
                              aria-label="Remove item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="font-mono text-sm font-semibold text-[#0B1F3A] tabular-nums shrink-0">
                          {formatMoney(item.price * item.quantity, settings.currency_code)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Guest Checkout Form */}
                  <form onSubmit={handleCheckout} className="space-y-4">
                    <h4 className="font-display text-sm font-bold text-[#0B1F3A]">
                      Customer & Fulfillment Details
                    </h4>

                    {checkoutError && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                        {checkoutError}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="e.g. Alice Uwase"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        required
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+250 788 000 000"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Fulfillment Option
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFulfillmentMethod('warehouse_collection')}
                          className={`p-3 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                            fulfillmentMethod === 'warehouse_collection'
                              ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <div className="font-semibold flex items-center gap-1.5">
                            <Warehouse className="w-3.5 h-3.5" />
                            <span>Warehouse Collection</span>
                          </div>
                          <div className="opacity-75 mt-0.5">Free bay pickup</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFulfillmentMethod('delivery')}
                          className={`p-3 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                            fulfillmentMethod === 'delivery'
                              ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <div className="font-semibold flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5" />
                            <span>Delivery Dispatch</span>
                          </div>
                          <div className="opacity-75 mt-0.5">
                            {cartSubtotal >= settings.free_delivery_threshold
                              ? 'Free over threshold'
                              : `${formatMoney(settings.delivery_fee, settings.currency_code)} fee`}
                          </div>
                        </button>
                      </div>
                    </div>

                    {fulfillmentMethod === 'delivery' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Delivery Address *
                        </label>
                        <input
                          type="text"
                          required
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder="Street, Sector, District"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                        />
                      </div>
                    )}

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-sm">
                      <div className="flex justify-between text-slate-600">
                        <span>Subtotal</span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(cartSubtotal, settings.currency_code)}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Delivery Fee</span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(computedDeliveryFee, settings.currency_code)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold text-[#0B1F3A] pt-2 border-t border-slate-200">
                        <span>Total Payable</span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(cartTotal, settings.currency_code)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={checkoutSubmitting}
                      className="w-full py-3 px-4 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {checkoutSubmitting ? 'Submitting Order...' : 'Place Guest Order'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Order Tracking Modal */}
      {trackModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-xl w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A]">Track Your Order</h3>
                <p className="text-xs text-slate-500">
                  Enter your Order Reference and checkout phone number
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTrackModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {confirmReceiptSuccess && (
                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-[#15803D]">
                  {confirmReceiptSuccess}
                </div>
              )}
              {confirmReceiptError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                  {confirmReceiptError}
                </div>
              )}

              {activeGuestOrders.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#0B1F3A]">
                    Your Saved Active Order{activeGuestOrders.length > 1 ? 's' : ''}
                  </div>
                  {activeGuestOrders.map(({ order, customer_phone }) => (
                    <div
                      key={order.order_reference}
                      className="p-4 rounded-xl bg-[#FDFBF4] border border-[#C99E44]/50 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-mono text-sm font-bold text-[#0B1F3A]">
                          {order.order_reference}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-2">
                          <StatusText status={order.status} />
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {formatMoney(order.total_amount, settings.currency_code)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTrackRef(order.order_reference);
                            setTrackPhone(customer_phone);
                            setTrackedOrder(order);
                            setTrackedOrderPhone(customer_phone);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold border border-slate-300 bg-white text-[#0B1F3A] rounded-lg hover:bg-slate-50 cursor-pointer"
                        >
                          Details
                        </button>
                        {order.status !== 'Cancelled' && (
                          <button
                            type="button"
                            disabled={confirmingOrderRef === order.order_reference}
                            onClick={() =>
                              void handleConfirmOrderReceived(order.order_reference, customer_phone)
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#15803D] text-white rounded-lg hover:bg-[#166534] disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {confirmingOrderRef === order.order_reference
                                ? 'Confirming...'
                                : 'Received'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleTrackOrder} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Order Reference
                    </label>
                    <input
                      type="text"
                      required
                      value={trackRef}
                      onChange={(e) => setTrackRef(e.target.value)}
                      placeholder="ORD-2026-1004"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={trackPhone}
                      onChange={(e) => setTrackPhone(e.target.value)}
                      placeholder="+250 788 554 040"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={openTrackWithSample}
                    className="text-xs text-[#9E7220] hover:underline cursor-pointer"
                  >
                    Fill sample order (ORD-2026-1004)
                  </button>
                  <button
                    type="submit"
                    disabled={trackLoading}
                    className="px-5 py-2 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] cursor-pointer"
                  >
                    {trackLoading ? 'Checking...' : 'Check Status'}
                  </button>
                </div>
              </form>

              {trackError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                  {trackError}
                </div>
              )}

              {trackedOrder && (
                <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/50">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                    <div>
                      <div className="font-mono text-sm font-bold text-[#0B1F3A]">
                        {trackedOrder.order_reference}
                      </div>
                      <div className="text-xs text-slate-500">
                        Placed {formatDateTime(trackedOrder.created_at)} · {trackedOrder.customer_name}
                      </div>
                    </div>
                    <StatusText status={trackedOrder.status} />
                  </div>

                  <div className="divide-y divide-slate-200 text-sm">
                    {trackedOrder.items.map((item, idx) => (
                      <div key={idx} className="py-2.5 flex justify-between gap-3">
                        <div>
                          <div className="font-medium text-[#0B1F3A]">{item.product_name}</div>
                          <div className="text-xs text-slate-500">
                            Seller <span className="font-mono">{item.storage_id}</span> ·{' '}
                            <span className="font-mono tabular-nums">
                              {item.quantity} {item.unit_label}
                            </span>
                          </div>
                        </div>
                        <div className="font-mono font-semibold tabular-nums text-[#0B1F3A]">
                          {formatMoney(item.subtotal, settings.currency_code)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex justify-between text-sm font-bold text-[#0B1F3A]">
                    <span>Total</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(trackedOrder.total_amount, settings.currency_code)}
                    </span>
                  </div>

                  {trackedOrder.customer_confirmed_received === 1 ? (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-[#15803D] flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Receipt confirmed by customer
                        {trackedOrder.customer_confirmed_at
                          ? ` on ${formatDateTime(trackedOrder.customer_confirmed_at)}`
                          : ''}
                      </span>
                    </div>
                  ) : (
                    trackedOrder.status !== 'Cancelled' &&
                    (trackedOrderPhone || trackPhone) && (
                      <button
                        type="button"
                        disabled={confirmingOrderRef === trackedOrder.order_reference}
                        onClick={() =>
                          void handleConfirmOrderReceived(
                            trackedOrder.order_reference,
                            trackedOrderPhone || trackPhone
                          )
                        }
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-[#15803D] text-white text-sm font-semibold rounded-lg hover:bg-[#166534] disabled:opacity-50 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {confirmingOrderRef === trackedOrder.order_reference
                            ? 'Confirming Receipt...'
                            : 'Received'}
                        </span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Member Storage Application Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A]">
                  Apply for Warehouse Storage
                </h3>
                <p className="text-xs text-slate-500">
                  Authorized staff review applications and assign one permanent Storage ID upon approval
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterMember} className="p-6 overflow-y-auto space-y-4">
              {regError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                  {regError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Contact Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Business / Entity Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={regBusinessName}
                    onChange={(e) => setRegBusinessName(e.target.value)}
                    placeholder="Company or trader name (optional)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="name@company.rw"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="+250 788 000 000"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Portal Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Requested Space (sqm) *
                  </label>
                  <input
                    type="number"
                    required
                    min={5}
                    max={5000}
                    value={regSpaceSqm}
                    onChange={(e) => setRegSpaceSqm(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#FDFBF4] border border-[#C99E44]/40 text-xs text-slate-700">
                <span>Estimated Monthly Fee ({settings.base_rate_per_sqm.toLocaleString()} {settings.currency_code}/sqm)</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Goods & Handling Notes
                </label>
                <textarea
                  rows={2}
                  value={regNotes}
                  onChange={(e) => setRegNotes(e.target.value)}
                  placeholder="Describe the products you plan to store (e.g. palletized cement, boxed tiles)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                />
              </div>

              <button
                type="submit"
                disabled={regLoading}
                className="w-full py-2.5 px-4 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] transition-colors cursor-pointer"
              >
                {regLoading ? 'Submitting Request...' : 'Submit Storage Request'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Portal Sign-In Modal (Separate Member vs Staff/Admin Access) */}
      {loginModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#061326]/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full overflow-hidden shadow-xl max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#9E7220]" />
                <h3 className="font-display text-lg font-bold text-[#0B1F3A]">
                  Kigali Vault · Portal Access
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLoginModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setLoginTab('member');
                    setLoginError(null);
                  }}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    loginTab === 'member'
                      ? 'bg-white text-[#0B1F3A] shadow-sm'
                      : 'text-slate-600 hover:text-[#0B1F3A]'
                  }`}
                >
                  Member Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginTab('staff_admin');
                    setLoginError(null);
                  }}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    loginTab === 'staff_admin'
                      ? 'bg-[#0B1F3A] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#0B1F3A]'
                  }`}
                >
                  Staff & Super Admin
                </button>
              </div>

              {loginError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#B91C1C]">
                  {loginError}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder={
                      loginTab === 'member'
                        ? 'member1@kigalibuild.rw'
                        : 'staff01@meridianvault.rw'
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-2.5 px-4 bg-[#0B1F3A] text-white text-sm font-semibold rounded-lg hover:bg-[#142E52] transition-colors cursor-pointer"
                >
                  {loginLoading
                    ? 'Signing In...'
                    : loginTab === 'member'
                      ? 'Sign In to Member Portal'
                      : 'Sign In to Operations Portal'}
                </button>
              </form>

              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowDemoHelper((v) => !v)}
                    className="text-xs font-medium text-[#9E7220] hover:underline cursor-pointer"
                  >
                    {showDemoHelper ? 'Hide Sample Credentials' : 'Show Sample Test Accounts'}
                  </button>
                  {loginTab === 'member' && (
                    <button
                      type="button"
                      onClick={() => {
                        setLoginModalOpen(false);
                        setRegisterModalOpen(true);
                      }}
                      className="text-xs text-slate-600 hover:text-[#0B1F3A] underline cursor-pointer"
                    >
                      Apply for Storage
                    </button>
                  )}
                </div>

                {showDemoHelper && (
                  <div className="mt-3 space-y-2">
                    {DEMO_ACCOUNTS.map((acc) => (
                      <button
                        key={acc.email}
                        type="button"
                        onClick={() => {
                          setLoginTab(acc.group === 'member' ? 'member' : 'staff_admin');
                          setLoginEmail(acc.email);
                          setLoginPassword(acc.pass);
                          setLoginError(null);
                        }}
                        className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-[#0B1F3A] hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#0B1F3A]">{acc.label}</span>
                          <span className="font-mono text-slate-500">{acc.email}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{acc.role}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {popupQueue.length > 0 && (
        <div data-mv-popup-modal="true">
          <PopupBannerModal
            popup={popupQueue[0]}
            onClose={dismissActivePopup}
            onAction={handleActivePopupAction}
          />
        </div>
      )}
    </div>
  );
}
