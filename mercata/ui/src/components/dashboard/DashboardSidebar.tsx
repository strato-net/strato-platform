import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Wallet, Database, LogOut, ArrowLeft, ArrowRight, Book, ArrowRightLeft, Send, Shield } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import MERCATALOGO from '@/assets/mercata.png';
import MERCATAICON from '@/assets/icon.png';

const DashboardSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { logout, isAdmin } = useUser();

  const allNavItems = [
    { icon: <LayoutDashboard size={20} />, label: 'Overview', path: '/dashboard' },
    { icon: <Wallet size={20} />, label: 'Assets', path: '/dashboard/assets' },
    { icon: <Send size={20} />, label: 'Transfer', path: '/dashboard/transfer' },
    { icon: <Book size={20} />, label: 'Borrow', path: '/dashboard/borrow' },
    { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
    { icon: <Database size={20} />, label: 'Pools', path: '/dashboard/pools' },
    { icon: <Shield size={20} />, label: 'Admin', path: '/dashboard/admin' },
  ];

  const navItems = allNavItems.filter(item => item.label !== 'Admin' || isAdmin);

  return (
    <div 
      className={`h-screen flex flex-col bg-sidebar-background text-sidebar-foreground fixed left-0 top-0 z-40 transition-all duration-300 border-r border-sidebar-border ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="border-b border-sidebar-border">
        {!collapsed && (
          <div className="p-4 flex items-center justify-between">
            <img 
              src={MERCATALOGO} 
              alt="STRATO mercata" 
              className="h-12" 
            />
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground"
            >
              <ArrowLeft size={16} />
            </button>
          </div>
        )}
        {collapsed && (
          <div className="p-4 flex flex-col items-center space-y-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground"
            >
              <ArrowRight size={16} />
            </button>
            <img 
              src={MERCATAICON} 
              alt="STRATO mercata" 
              className="h-8" 
            />
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto py-4">
        <nav className="flex-1">
          <ul className="space-y-1">
            {navItems.map((item, index) => (
              <li key={index}>
                <Link
                  to={item.path}
                  className="flex items-center px-4 py-2.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md mx-2"
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!collapsed && <span className="ml-3">{item.label}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto">
          <button
            onClick={logout}
            className={`flex items-center text-red-400 hover:bg-red-500/10 w-full rounded-md px-4 py-2.5 ${
              collapsed ? 'justify-center mx-auto' : ''
            }`}
          >
            <LogOut size={20} />
            {!collapsed && <span className="ml-3">Log Out</span>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardSidebar;