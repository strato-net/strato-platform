import { api } from './axios';
import type { EventResponse, ContractInfoResponse } from '@mercata/shared-types';

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
  getEvents: async (filters: EventsFilters = {}): Promise<EventResponse> => {
    const params = new URLSearchParams();
    
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
    
    if (filters.contract_name) params.append('storage.contract.contract_name', filters.contract_name);
    if (filters.event_name) params.append('event_name', filters.event_name);
    if (filters.transaction_sender) params.append('transaction_sender', filters.transaction_sender);

    const response = await api.get(`/events?${params.toString()}`);
    return response.data as EventResponse;
  },

  /**
   * Get contract names and event names for filtering
   */
  getFilterOptions: async (): Promise<{ 
    contractNames: string[]; 
    eventNames: Array<{ name: string; contract: string }>;
  }> => {
    const response = await api.get('/events/contracts');
    const data = response.data as ContractInfoResponse;
    
    const contractNames = data.contracts.map(contract => contract.name);
    
    const eventNames = data.contracts.flatMap(contract => 
      contract.events.map(eventName => ({
        name: eventName,
        contract: contract.name
      }))
    );
    
    return { contractNames, eventNames };
  }
};

 