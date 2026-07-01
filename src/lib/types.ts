// Mirrors the web app's DB types (minimum subset used by mobile).

export type VehicleStatus =
  | "draft" | "inspection_scheduled" | "inspected"
  | "pending_review" | "changes_requested"
  | "listed" | "in_auction"
  | "sold"  | "payment_pending" | "paid" | "collected" | "shipped" | "delivered";

export type AuctionStatus = "scheduled" | "active" | "ended" | "sold" | "cancelled";

export interface VehicleRow {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileage_km: number;
  fuel_type: string;
  transmission: string;
  exterior_color: string | null;
  interior_color: string | null;
  body_type: string | null;
  engine: string | null;
  drivetrain: string | null;
  market_spec: string | null;
  location_city: string;
  location_country: string;
  status: VehicleStatus;
  listed_price_eur: number | null;
  reserve_price_eur: number | null;
  buy_now_price_eur: number | null;
  description: string | null;
  features: string[] | null;
  // Seller identity/contact lives in the staff-only vehicle_sellers table
  // (migrations 028/029), not on the vehicles row.
  inspector_id?: string | null;
  inspection_date?: string | null;
  inspection_notes?: string | null;
  review_notes?: string | null;
}

export interface AuctionRow {
  id: string;
  vehicle_id: string;
  status: AuctionStatus;
  start_time: string;
  end_time: string;
  starting_price_eur: number;
  current_bid_eur: number | null;
  buy_now_price_eur: number | null;
  reserve_price_eur: number | null;
  bid_count: number;
  bidder_count: number;
  winner_id: string | null;
}

export interface VehiclePhotoRow {
  id: string;
  vehicle_id: string;
  url: string;
  sort_order: number;
  caption: string | null;
  category: string;
}

export interface VehicleDamageRow {
  id: string;
  vehicle_id: string;
  location: string;
  description: string;
  severity: "cosmetic" | "minor" | "moderate" | "major";
}

export interface BidRow {
  id: string;
  auction_id: string;
  bidder_id: string;
  amount_eur: number;
  is_proxy: boolean;
  proxy_max_eur: number | null;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  company_name: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  role: "buyer" | "admin" | "inspector" | "superadmin";
  kyc_status: "pending" | "verified" | "rejected";
}
