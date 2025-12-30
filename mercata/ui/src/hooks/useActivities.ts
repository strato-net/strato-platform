import { useState, useEffect, useCallback } from "react";
import { activityFeedApi, ActivitiesFilters } from "@/lib/activityFeed";

// Activity item type (matches backend response)
interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  fromAddress: string;
  amount: string;
  amountToken: string;
  isPositive: boolean;
  timestamp: string;
  txHash?: string;
  eventName: string;
  contractName: string;
  attributes: Record<string, string>;
}

interface UseActivitiesOptions {
  userAddress?: string;
  type?: string;
  period?: string;
  limit?: number;
}

export const useActivities = (options: UseActivitiesOptions = {}) => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);

  const limit = options.limit || 20;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const filters: ActivitiesFilters = {
        user: options.userAddress,
        type: options.type,
        period: options.period,
        limit,
        offset: (page - 1) * limit,
      };
      const data = await activityFeedApi.getActivities(filters);
      setActivities(data.activities);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch activities"));
    } finally {
      setLoading(false);
    }
  }, [options.userAddress, options.type, options.period, limit, page]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchData, 300); // Debounce
    return () => clearTimeout(timeoutId);
  }, [fetchData]);

  const refetch = useCallback(() => fetchData(), [fetchData]);

  const totalPages = Math.ceil(total / limit);

  return {
    activities,
    total,
    loading,
    error,
    refetch,
    page,
    setPage,
    totalPages,
  };
};

