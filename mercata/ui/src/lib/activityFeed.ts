import { api } from './axios';

export interface EventAttribute {
  [key: string]: string;
}

export interface BlockchainEvent {
  address: string;
  block_hash: string;
  block_timestamp: string;
  block_number: string;
  transaction_hash: string;
  transaction_sender: string;
  event_index: number;
  creator: string;
  application: string;
  contract_name: string;
  event_name: string;
  attributes: EventAttribute;
}

export interface EventsResponse {
  events: BlockchainEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface EventsFilters {
  limit?: number;
  offset?: number;
  contract_name?: string;
  event_name?: string;
  transaction_sender?: string;
}

export const activityFeedApi = {
  /**
   * Fetch blockchain events with pagination and filters
   */
  getEvents: async (filters: EventsFilters = {}): Promise<EventsResponse> => {
    const params = new URLSearchParams();

    // Add pagination parameters
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    // Add filter parameters
    if (filters.contract_name) params.append('contract_name', filters.contract_name);
    if (filters.event_name) params.append('event_name', filters.event_name);
    if (filters.transaction_sender) params.append('transaction_sender', filters.transaction_sender);

    // Backend endpoint: /events (since baseURL is already /api)
    const response = await api.get(`/events?${params.toString()}`);

    // If the backend returns a different format, we can transform it here
    const data = response.data;

    // Handle different response formats
    if (Array.isArray(data)) {
      // If backend returns just an array of events
      const currentPage = Math.floor((filters.offset || 0) / (filters.limit || 10)) + 1;
      return {
        events: data,
        total: data.length,
        page: currentPage,
        limit: filters.limit || 10,
        totalPages: Math.ceil(data.length / (filters.limit || 10))
      };
    }

    // If backend returns the new format with events and total
    if (data.events && typeof data.total === 'number') {
      const currentPage = Math.floor((filters.offset || 0) / (filters.limit || 10)) + 1;
      return {
        events: data.events,
        total: data.total,
        page: currentPage,
        limit: filters.limit || 10,
        totalPages: Math.ceil(data.total / (filters.limit || 10))
      };
    }

    // If backend returns the expected format
    return data;
  },

  /**
   * Get contract names and event names for filtering
   */
  getFilterOptions: async (): Promise<{
    contractNames: string[];
    eventNames: Array<{ name: string; contract: string }>;
  }> => {
    const response = await api.get('/events/contracts');
    const data = response.data as { contracts: Array<{ name: string; events: string[] }> };

    const contractNames = data.contracts.map(contract => contract.name);

    // Create events with contract association
    const eventNames = data.contracts.flatMap(contract =>
      contract.events.map(eventName => ({
        name: eventName,
        contract: contract.name
      }))
    );

    return { contractNames, eventNames };
  }
};

