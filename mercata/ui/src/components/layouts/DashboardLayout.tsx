import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import DashboardSidebar from '../dashboard/DashboardSidebar';
import MobileSidebar from '../dashboard/MobileSidebar';
import { ModeToggle } from '../mode-toggle';

const DashboardLayout = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <main className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <header className="flex justify-end items-center p-4 border-b">
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