/**
 * Order Client Types
 *
 * Reusable types for the order client module.
 */

// Token IDs for the binary market
export interface MarketTokens {
  yes: string;  // Token ID for YES/UP outcome
  no: string;   // Token ID for NO/DOWN outcome
}

// Configuration for creating an order client
export interface OrderClientConfig {
  privateKey: string;       // Ethereum private key (0x...)
  tokens: MarketTokens;     // Market token IDs
  defaultShares: number;    // Default shares for pre-signing orders
  proxyAddress?: string;    // Polymarket proxy address (optional)
  signatureType?: number;   // Signature type (default: 0)
}

// Internal credentials derived from private key
export interface DerivedCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

// Result of an order operation
export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

// Direction type for orders
export type OrderDirection = 'yes' | 'no';

// Tick size types supported by Polymarket
export type TickSize = '0.1' | '0.01' | '0.001' | '0.0001';

// Cached market parameters to avoid API calls during order creation
export interface CachedMarketParams {
  tickSize: TickSize;
  negRisk: boolean;
  feeRateBps: number;
}

// Pre-signed order for instant submission
export interface PreSignedOrder {
  priceCents: number;
  direction: OrderDirection;
  size: number;
  signedOrder: any;  // The signed order object from createOrder()
  used: boolean;
  createdAt: number;
}

// Internal state for connection management
export interface ConnectionState {
  warmedUp: boolean;
  requestCount: number;
  firstTtfb: number | null;
  recentTtfbs: number[];
}
