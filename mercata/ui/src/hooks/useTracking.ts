import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/context/UserContext';
import {
  createTrackingLink,
  getTrackingActivity,
  getTrackingMe,
  getTrackingSnapshot,
  setTrackingLinkActive,
  TrackingActivityResponse,
  TrackingApiError,
} from '@/lib/trackingApi';
import { collectTrackedAddresses, computeTracking, TrackingComputed } from '@/lib/trackingEngine';

export const trackingKeys = {
  me: ['tracking', 'me'] as const,
  snapshot: ['tracking', 'snapshot'] as const,
  activity: (addresses: string[]) => ['tracking', 'activity', addresses.join(',')] as const,
};

const EMPTY_ACTIVITY: TrackingActivityResponse = { events: [], bridgeIns: [] };

// One cached probe per session; guests never hit the endpoint. A 401/403 is
// "not authorized", not an error.
export function useTrackingAccess() {
  const { isAppAuthenticated } = useUser();
  const query = useQuery({
    queryKey: trackingKeys.me,
    queryFn: async () => {
      try {
        return await getTrackingMe();
      } catch (error) {
        if (error instanceof TrackingApiError && (error.status === 401 || error.status === 403)) {
          return { authorized: false };
        }
        throw error;
      }
    },
    enabled: isAppAuthenticated,
    staleTime: Infinity,
    retry: false,
  });
  return {
    authorized: query.data?.authorized ?? false,
    isLoading: isAppAuthenticated && query.isPending,
  };
}

// The dashboard's data spine: offchain snapshot from the tracking service +
// chain activity for the tracked addresses from the mercata backend, joined
// client-side by the attribution engine.
export function useTrackingData(enabled: boolean) {
  const snapshot = useQuery({
    queryKey: trackingKeys.snapshot,
    queryFn: getTrackingSnapshot,
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const addresses = useMemo(
    () => (snapshot.data ? collectTrackedAddresses(snapshot.data) : []),
    [snapshot.data]
  );

  const activity = useQuery({
    queryKey: trackingKeys.activity(addresses),
    queryFn: () => getTrackingActivity(addresses),
    enabled: enabled && addresses.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const computed: TrackingComputed | null = useMemo(() => {
    if (!snapshot.data) return null;
    if (addresses.length > 0 && !activity.data) return null;
    return computeTracking(snapshot.data, activity.data ?? EMPTY_ACTIVITY);
  }, [snapshot.data, activity.data, addresses.length]);

  return {
    computed,
    isPending: snapshot.isPending || (addresses.length > 0 && activity.isPending),
    isError: snapshot.isError || activity.isError,
    refetch: () => {
      snapshot.refetch();
      if (addresses.length > 0) activity.refetch();
    },
  };
}

export function useCreateTrackingLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTrackingLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackingKeys.snapshot });
    },
  });
}

export function useSetTrackingLinkActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setTrackingLinkActive(id, active),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: trackingKeys.snapshot });
    },
  });
}
