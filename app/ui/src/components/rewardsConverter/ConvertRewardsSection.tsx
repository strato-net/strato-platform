import { useUser } from "@/context/UserContext";
import { useRewardsConverterState } from "@/hooks/useRewardsConverter";
import ConversionHistory from "./ConversionHistory";
import ConvertRewardsCard from "./ConvertRewardsCard";

const ConvertRewardsSection = () => {
  const { isLoggedIn } = useUser();
  const { data: state, refetch } = useRewardsConverterState();

  if (!state?.configured) return null;

  return (
    <div>
      <ConvertRewardsCard state={state} refetchState={refetch} />
      {isLoggedIn && (
        <div className="px-2 md:px-6">
          <div className="max-w-2xl mx-auto">
            <ConversionHistory rewardsToken={state.rewardsToken} stratoToken={state.stratoToken} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ConvertRewardsSection;
