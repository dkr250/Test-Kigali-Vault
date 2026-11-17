export type UserRole = 'member' | 'staff' | 'super_admin';

export interface StaffPermissionSet {
  staff_code: string;
  title: string;
  can_manage_storage: boolean;
  can_manage_inventory: boolean;
  can_manage_orders: boolean;
  can_view_reports: boolean;
  can_assist_members: boolean;
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  role: UserRole;
  status: string;
  staff_permissions: StaffPermissionSet | null;
  storage_id: string | null;
  member_id: number | null;
  application_status: string | null;
}

export interface PublicSettings {
  warehouse_name: string;
  currency_code: string;
  base_rate_per_sqm: number;
  delivery_fee: number;
  free_delivery_threshold: number;
  warehouse_address: string;
  support_phone: string;
  allow_guest_checkout: boolean;
}

export interface PublicListing {
  listing_token: string;
  storage_id: string;
  name: string;
  category: string;
  description: string;
  unit_label: string;
  price: number;
  available_qty: number;
  image_url: string;
  gallery_urls: string[];
  status: 'Available' | 'Out of Stock';
  created_at: string;
}

export interface CartItem {
  listing_token: string;
  storage_id: string;
  name: string;
  unit_label: string;
  price: number;
  available_qty: number;
  image_url: string;
  quantity: number;
}

export interface OrderConfirmationItem {
  storage_id: string;
  product_name: string;
  unit_label: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

export interface OrderDetails {
  order_reference: string;
  customer_name: string;
  customer_phone?: string;
  fulfillment_method: 'warehouse_collection' | 'delivery';
  delivery_address: string;
  delivery_fee: number;
  subtotal_amount: number;
  total_amount: number;
  status:
    | 'Pending Confirmation'
    | 'Confirmed'
    | 'Ready for Collection'
    | 'Out for Delivery'
    | 'Completed'
    | 'Cancelled';
  sale_processed?: number;
  customer_confirmed_received?: number;
  customer_confirmed_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at?: string;
  items: OrderConfirmationItem[];
}

export interface MemberNotification {
  id: number;
  category: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface MemberProduct {
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
  gallery_urls: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface OperationalProduct extends MemberProduct {
  listing_token: string;
  storage_id: string;
  business_name: string;
}

export interface AuditLogEntry {
  id: number;
  actor_label: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_ref: string;
  details: string;
  created_at: string;
}

export interface ProductCategory {
  id: number;
  name: string;
  sort_order: number;
}

export interface HeroSlide {
  id: number;
  media_url: string;
  media_type: 'image' | 'video';
  headline: string;
  location_text: string;
  dispatch_text: string;
  sort_order: number;
  is_active?: boolean;
}

export type PopupTriggerType =
  | 'first_visit'
  | 'delay_seconds'
  | 'scroll_percent'
  | 'click_count'
  | 'interaction_target';

export type PopupInteractionTarget =
  | 'any'
  | 'category_filter'
  | 'search_input'
  | 'product_card'
  | 'cart_button'
  | 'storage_apply';

export type PopupDisplayFrequency = 'once_ever' | 'once_per_session' | 'every_visit';

export interface PopupBannerConfig {
  id?: number;
  title?: string;
  is_enabled: boolean;
  image_url: string;
  headline: string;
  description: string;
  cta_label: string;
  text_position: 'top' | 'center' | 'bottom' | 'below_image';
  text_align: 'left' | 'center' | 'right';
  text_order: 'headline_first' | 'description_first';
  overlay_style: 'dark_scrim' | 'navy_banner' | 'light_card' | 'transparent';
  text_color: 'white' | 'navy' | 'gold';
  trigger_type: PopupTriggerType;
  trigger_delay_seconds: number;
  trigger_scroll_percent: number;
  trigger_click_threshold: number;
  trigger_interaction_target: PopupInteractionTarget;
  display_frequency: PopupDisplayFrequency;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

