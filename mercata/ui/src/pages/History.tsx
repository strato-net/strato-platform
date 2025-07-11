import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import HistorySection from "../components/dashboard/HistorySection";

const History = () => (
  <div className="min-h-screen bg-gray-50 flex">
    <DashboardSidebar />
    <div className="flex-1 ml-64">
      <DashboardHeader title="History" />
      <HistorySection />
    </div>
  </div>
);

export default History;
