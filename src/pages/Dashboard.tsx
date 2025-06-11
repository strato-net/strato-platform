import { useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import { Wallet, Coins, ChartBar, Shield } from "lucide-react";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { tokens, loading, fetchTokens } = useUserTokens();

  useEffect(() => {
    document.title = "Dashboard | STRATO Mercata";
    setTimeout(() => {
      fetchTokens(userAddress || "");
    }, 500);
  }, [userAddress]);

  useEffect(() => {
    if (!searchParams) return;
    const successParam = searchParams.get("success");

    if (successParam !== "false" && successParam !== "true") return;

    if (successParam === "true") {
      toast?.({
        title: "Purchase Successful",
        description: "Your purchase was completed successfully.",
      });
      navigate("/dashboard", { replace: true });
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title="Overview" />

        <main className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <AssetSummary
              title="Total Balance"
              value="$4,327.39"
              change={2.5}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
            />

            <AssetSummary
              title="CATA Rewards"
              value="287.53 CATA"
              change={12.3}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
            />

            <AssetSummary
              title="Portfolio Growth"
              value="8.4%"
              change={3.7}
              icon={<ChartBar className="text-white" size={18} />}
              color="bg-green-500"
            />

            <AssetSummary
              title="Borrowing"
              value="$1,250.00"
              change={0}
              icon={<Shield className="text-white" size={18} />}
              color="bg-orange-500"
            />
          </div>

          <div className="mb-8">
            <AssetsList loading={loading} tokens={tokens} />
          </div>

          <div className="mb-8">
            <BorrowingSection />
          </div>

          <div className="mb-8">
            <DashboardFAQ />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
