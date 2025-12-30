// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Contract information with associated events
 */
export interface ContractInfo {
  name: string;
  events: string[];
}

/**
 * Raw event data as received from the API
 */
export interface EventData {
  event_name?: string;
  storage?: {
    contract?: Array<{
      contract_name?: string;
    }>;
  };
}

/**
 * Individual event data structure
 */
export interface Event {
  id: number;
  address: string;
  block_hash: string;
  block_timestamp: string;
  block_number: string;
  transaction_sender: string;
  event_index: number;
  contract_name: string;
  event_name: string;
  attributes: Record<string, string>;
}

/**
 * Event response with pagination
 */
export interface EventResponse {
  events: Event[];
  total: number;
}

/**
 * Contract info response
 */
export interface ContractInfoResponse {
  contracts: ContractInfo[];
}

// ============================================================================
// ACTIVITY TYPES
// ============================================================================

/**
 * User-friendly activity item
 */
export interface ActivityItem {
  id: string;
  type: string; // deposit, withdraw, borrow, swap, bridge, cdp
  title: string;
  description: string;
  fromAddress: string;
  fromLabel?: string;
  toLabel?: string;
  amount: string;
  amountToken: string;
  isPositive: boolean;
  timestamp: string;
  txHash?: string;
  eventName: string;
  contractName: string;
  attributes: Record<string, string>;
}

/**
 * Activities response with pagination
 */
export interface ActivitiesResponse {
  activities: ActivityItem[];
  total: number;
}
