import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Gift, Activity, Menu, Download, BarChart3, Droplets, Shield, X } from 'lucide-react';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import { useUser } from '@/context/UserContext';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
  { icon: Gift, label: 'Rewards', path: '/dashboard/rewards' },
  { icon: Activity, label: 'Activity', path: '/dashboard/activity' },
];

const MORE_ITEMS = [
  { icon: Download, label: 'Withdraw', path: '/dashboard/withdrawals' },
  { icon: BarChart3, label: 'Mercata Stats', path: '/dashboard/stats' },
  { icon: Droplets, label: 'Advanced', path: '/dashboard/advanced' },
  { icon: Shield, label: 'Admin', path: '/dashboard/admin', adminOnly: true },
];

const MobileBottomNav = () => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAdmin } = useUser();

  const isActive = (path: string) => 
    path === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(path);

  const isMoreActive = MORE_ITEMS.some(item => isActive(item.path));

  const handleMoreItemClick = (path: string) => {
    setIsMoreOpen(false);
    navigate(path);
  };

  const filteredMoreItems = MORE_ITEMS.filter(item => !item.adminOnly || isAdmin);

  return (
    <>
      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 md:hidden">
        <div className="flex items-center justify-around h-16">
          {NAV_ITEMS.map(({ icon: Icon, label, path }) => (
            <Link
              key={path}
              to={path}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-1 ${
                isActive(path) ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon size={20} />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          ))}
          
          {/* More Button */}
          <button
            onClick={() => setIsMoreOpen(true)}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-1 ${
              isMoreActive ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Menu size={20} />
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More Drawer - Compact with smooth animation */}
      <Drawer open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <DrawerContent className="pb-6">
          {/* Close Button */}
          <div className="flex justify-end p-3">
            <DrawerClose asChild>
              <button className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors">
                <X size={16} />
              </button>
            </DrawerClose>
          </div>
          
          {/* Menu Items */}
          <div className="px-4 space-y-1">
            {filteredMoreItems.map(({ icon: Icon, label, path }) => (
              <button
                key={path}
                onClick={() => handleMoreItemClick(path)}
                className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors ${
                  isActive(path)
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{label}</span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default MobileBottomNav;
