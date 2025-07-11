import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import HistorySection from "../components/dashboard/HistorySection";

const History = () => (
  <div className="min-h-screen bg-gray-50 flex">
    <DashboardSidebar />
    <div className="flex-1 ml-64">
      <HistorySection />
    </div>
  </div>
);

export default History;
