import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/context/UserContext';
import {
  createTrackingLink,
  getTrackingLink,
  getTrackingMe,
  listTrackingLinks,
  setTrackingLinkActive,
  TrackingApiError,
  TrackingLinkSummary,
} from '@/lib/trackingApi';

export const trackingKeys = {
  me: ['tracking', 'me'] as const,
  links: ['tracking', 'links'] as const,
  link: (id: string) => ['tracking', 'links', id] as const,
};

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

export function useTrackingLinks(enabled: boolean) {
  return useQuery({
    queryKey: trackingKeys.links,
    queryFn: listTrackingLinks,
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTrackingLink(id: string | undefined) {
  return useQuery({
    queryKey: trackingKeys.link(id ?? ''),
    queryFn: () => getTrackingLink(id!),
    enabled: !!id,
  });
}

export function useCreateTrackingLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTrackingLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackingKeys.links });
    },
  });
}

export function useSetTrackingLinkActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setTrackingLinkActive(id, active),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: trackingKeys.links });
      const previous = queryClient.getQueryData<TrackingLinkSummary[]>(trackingKeys.links);
      queryClient.setQueryData<TrackingLinkSummary[]>(trackingKeys.links, (links) =>
        links?.map((link) => (link.id === id ? { ...link, active } : link))
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(trackingKeys.links, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: trackingKeys.links });
    },
  });
}
