import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Wallet, Database, LogOut, ArrowLeft, ArrowRight, Book, ArrowRightLeft, Send } from 'lucide-react';

const DashboardSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const navItems = [
    { icon: <LayoutDashboard size={20} />, label: 'Overview', path: '/dashboard' },
    { icon: <Wallet size={20} />, label: 'Assets', path: '/dashboard/assets' },
    { icon: <Send size={20} />, label: 'Transfer', path: '/dashboard/transfer' },
    { icon: <Book size={20} />, label: 'Borrow', path: '/dashboard/borrow' },
    { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
    { icon: <Database size={20} />, label: 'Pools', path: '/dashboard/pools' },
  ];

  return (
    <div 
      className={`h-screen flex flex-col bg-sidebar-background text-sidebar-foreground fixed left-0 top-0 z-40 transition-all duration-300 border-r border-sidebar-border ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="p-4 flex items-center justify-between border-b border-sidebar-border">
        <div className={`flex items-center ${collapsed ? 'justify-center w-full' : ''}`}>
          {collapsed ? (
            <img 
              src="/lovable-uploads/de952550-4201-4e43-99f4-72cdcf272c55.png" 
              alt="STRATO mercata" 
              className="h-8" 
            />
          ) : (
            <img 
              src="/lovable-uploads/de952550-4201-4e43-99f4-72cdcf272c55.png" 
              alt="STRATO mercata" 
              className="h-12" 
            />
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground ${collapsed ? 'mx-auto' : ''}`}
        >
          {collapsed ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
        </button>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto py-4">
        <nav className="flex-1">
          <ul className="space-y-1">
            {navItems.map((item, index) => (
              <li key={index}>
                <a
                  href={item.path}
                  className="flex items-center px-4 py-2.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md mx-2"
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!collapsed && <span className="ml-3">{item.label}</span>}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => navigate('/auth/logout')}
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