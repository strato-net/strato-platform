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
   * Fetch activities filtered by exact (contract_name, event_name) pairs
   */
  getActivities: async (
    activityTypePairs: Array<{ contract_name: string; event_name: string }>,
    options: {
      limit?: number;
      offset?: number;
      myActivity?: boolean;
    } = {}
  ): Promise<EventResponse> => {
    const params = new URLSearchParams();
    
    // Format: "contract1:event1,contract2:event2"
    const activityTypesStr = activityTypePairs
      .map(p => `${p.contract_name}:${p.event_name}`)
      .join(',');
    params.append('activity_types', activityTypesStr);
    
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());
    if (options.myActivity) params.append('my_activity', 'true');

    const response = await api.get(`/events/activities?${params.toString()}`);
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

 