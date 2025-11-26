import { useState, useEffect } from "react";
import { fetchActivities, Activity } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

export const useRewardsActivities = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isLoggedIn } = useUser();

  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await fetchActivities();
        setActivities(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch activities"));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  return { activities, loading, error, refetch: () => fetchActivities().then(setActivities) };
};

