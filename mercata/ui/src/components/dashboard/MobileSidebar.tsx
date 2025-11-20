import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wallet, Database, Book, ArrowRightLeft, Send, Shield, X, Activity, BarChart3, ChevronDown, ChevronRight, GraduationCap, Droplets, TrendingUp, ShieldCheck, AlertTriangle, Building2, Vault } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import MERCATALOGO from '@/assets/mercata.png';

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const MobileSidebar = ({ isOpen, onClose }: MobileSidebarProps) => {
  const { isAdmin } = useUser();
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'Deposit': true, 'Borrow': true, 'Pools': true, 'Activity': true });

  const allNavItems: Array<{ icon: React.ReactNode; label: string; path?: string; items?: Array<{ icon: React.ReactNode; label: string; path: string }> }> = [
    {
      icon: <Wallet size={20} />,
      label: 'Deposit',
      items: [
        { icon: <Wallet size={20} />, label: 'Bridge', path: '/dashboard/deposits' },
        { icon: <Send size={20} />, label: 'Transfer', path: '/dashboard/transfer' },
      ]
    },
    {
      icon: <Book size={20} />,
      label: 'Borrow',
      items: [
        { icon: <Building2 size={20} />, label: 'Lending Pool', path: '/dashboard/borrow/lending' },
        { icon: <Vault size={20} />, label: 'CDP Vaults', path: '/dashboard/borrow/cdp' },
      ]
    },
    { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
    {
      icon: <Database size={20} />,
      label: 'Pools',
      items: [
        { icon: <Droplets size={20} />, label: 'Lending Pools', path: '/dashboard/pools/lending' },
        { icon: <TrendingUp size={20} />, label: 'Swap Pools', path: '/dashboard/pools/swap' },
        { icon: <ShieldCheck size={20} />, label: 'Safety Module', path: '/dashboard/pools/safety' },
        { icon: <AlertTriangle size={20} />, label: 'Liquidations', path: '/dashboard/pools/liquidations' },
      ]
    },
    {
      icon: <Activity size={20} />,
      label: 'Activity',
      items: [
        { icon: <BarChart3 size={20} />, label: 'Mercata Stats', path: '/dashboard/stats' },
        { icon: <Activity size={20} />, label: 'Activity Feed', path: '/dashboard/activity' },
      ]
    },
    { icon: <Shield size={20} />, label: 'Admin', path: '/dashboard/admin' },
  ];

  const navItems = allNavItems.filter(item => {
    if (item.path === '/dashboard/admin') return isAdmin;
    return true;
  });

  const isActive = (itemPath: string) => {
    if (itemPath === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(itemPath);
  };

  const toggleGroup = (groupLabel: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      
      {/* Mobile Sidebar */}
      <div className={`fixed left-0 top-0 h-full w-64 bg-white text-gray-900 z-50 md:hidden transform transition-transform duration-300 ease-in-out border-r border-gray-200 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="border-b border-gray-200">
          <div className="p-4 flex items-center justify-between">
            <Link to="/dashboard" onClick={onClose} className="hover:opacity-80 transition-opacity">
              <img
                src={MERCATALOGO}
                alt="STRATO mercata"
                className="h-12"
              />
            </Link>
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-gray-100 text-gray-700"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-col flex-1 overflow-y-auto py-4">
          <nav className="flex-1">
            <ul className="space-y-1">
              {navItems.map((item, index) => {
                // Handle grouped items
                if (item.items && item.items.length > 0) {
                  const isExpanded = expandedGroups[item.label];
                  const hasActiveChild = item.items.some(child => isActive(child.path));

                  return (
                    <li key={index}>
                      <button
                        onClick={() => toggleGroup(item.label)}
                        className={`flex items-center justify-between px-4 py-2.5 rounded-md mx-2 transition-colors duration-200 w-full ${
                          hasActiveChild
                            ? 'text-black font-semibold'
                            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <span className={`flex-shrink-0 ${hasActiveChild ? 'text-black' : ''}`}>{item.icon}</span>
                          <span className={`ml-3 ${hasActiveChild ? 'font-semibold' : ''}`}>{item.label}</span>
                        </div>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      {isExpanded && (
                        <ul className="ml-8 mt-1 space-y-1">
                          {item.items.map((child, childIndex) => {
                            const childActive = isActive(child.path);
                            return (
                              <li key={childIndex}>
                                <Link
                                  to={child.path}
                                  onClick={onClose}
                                  className={`flex items-center px-4 py-2 rounded-md mx-2 transition-colors duration-200 ${
                                    childActive
                                      ? 'bg-muted text-black font-semibold'
                                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                                  }`}
                                >
                                  <span className={`flex-shrink-0 ${childActive ? 'text-black' : ''}`}>{child.icon}</span>
                                  <span className={`ml-3 text-sm ${childActive ? 'font-semibold' : ''}`}>{child.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                }

                // Handle regular items (non-grouped)
                const active = item.path ? isActive(item.path) : false;
                return (
                  <li key={index}>
                    <Link
                      to={item.path!}
                      onClick={onClose}
                      className={`flex items-center px-4 py-2.5 rounded-md mx-2 transition-colors duration-200 ${
                        active
                          ? 'bg-muted text-black font-semibold border-l-4 border-primary'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <span className={`flex-shrink-0 ${active ? 'text-black' : ''}`}>{item.icon}</span>
                      <span className={`ml-3 ${active ? 'font-semibold' : ''}`}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* DeFi Learning CTA */}
          <div className="px-4 pb-4 mt-4">
            <a
              href="https://blockapps.net/defi-guide"
              target="_blank"
              rel="noopener noreferrer"
              className="block p-4 bg-gradient-to-br from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
              onClick={onClose}
            >
              <div className="flex items-center gap-3 mb-2">
                <GraduationCap size={20} />
                <span className="font-semibold">Learn DeFi</span>
              </div>
              <p className="text-xs opacity-90">
                New to DeFi? Learn the basics and get started with our comprehensive guide.
              </p>
            </a>
          </div>
        </div>
      </div>
    </>
  );
};

export default MobileSidebar;