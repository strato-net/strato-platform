import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import DashboardSidebar from '../dashboard/DashboardSidebar';
import MobileSidebar from '../dashboard/MobileSidebar';
import { ModeToggle } from '../mode-toggle';
import LiquidationNotification from '../ui/LiquidationNotification';
import { useUser } from '@/context/UserContext';

const DashboardLayout = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { isLoggedIn } = useUser();

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <main className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <header className="flex justify-end items-center gap-2 p-4 border-b">
          {isLoggedIn && <LiquidationNotification />}
          <ModeToggle />
        </header>
        <div className="container mx-auto p-6">
          <Outlet context={{ onMenuClick: () => setIsMobileSidebarOpen(true) }} />
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout; 