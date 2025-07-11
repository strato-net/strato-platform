import { Outlet } from 'react-router-dom';
import DashboardSidebar from '../dashboard/DashboardSidebar';

const DashboardLayout = () => {
  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <main className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
        <div className="container mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout; 