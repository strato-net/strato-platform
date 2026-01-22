import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ArrowUpDown, 
  Landmark, 
  ArrowLeftRight, 
  Menu, 
  Send, 
  Gift, 
  Activity, 
  Download, 
  BarChart3, 
  Droplets, 
  Shield,
  UserPlus,
  LineChart,
  X 
} from 'lucide-react';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import { useUser } from '@/context/UserContext';

// Primary navigation items shown in bottom bar
const PRIMARY_NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
  { icon: ArrowUpDown, label: 'Deposit', path: '/dashboard/deposits' },
  { icon: Landmark, label: 'Borrow', path: '/dashboard/borrow' },
  { icon: ArrowLeftRight, label: 'Swap', path: '/dashboard/swap' },
];

// Items shown in "More" drawer
const MORE_ITEMS = [
  { icon: Send, label: 'Transfer', path: '/dashboard/transfer' },
  { icon: Gift, label: 'Rewards', path: '/dashboard/rewards' },
  { icon: Activity, label: 'Activity Feed', path: '/dashboard/activity' },
  { icon: Download, label: 'Withdrawals', path: '/dashboard/withdrawals' },
  { icon: BarChart3, label: 'STRATO Stats', path: '/dashboard/stats' },
  { icon: LineChart, label: 'Trading Desk', path: '/dashboard/trading-desk' },
  { icon: Droplets, label: 'Advanced', path: '/dashboard/advanced' },
  { icon: UserPlus, label: 'My Referrals', path: '/dashboard/referrals' },
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
          {PRIMARY_NAV_ITEMS.map(({ icon: Icon, label, path }) => (
            <Link
              key={path}
              to={path}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors ${
                isActive(path) 
                  ? 'text-blue-600 dark:text-blue-400' 
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon size={20} />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          ))}
          
          {/* More Button */}
          <button
            onClick={() => setIsMoreOpen(true)}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors ${
              isMoreActive 
                ? 'text-blue-600 dark:text-blue-400' 
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Menu size={20} />
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More Drawer */}
      <Drawer open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <DrawerContent className="max-h-[70vh] pb-7">
          {/* Close Button */}
          <div className="flex justify-end px-4 pt-3">
            <DrawerClose asChild>
              <button className="p-1.5 rounded-md hover:bg-muted transition-colors">
                <X size={18} className="text-muted-foreground" />
              </button>
            </DrawerClose>
          </div>
          
          {/* Menu Items */}
          <div className="px-3 pb-4">
            {filteredMoreItems.map(({ icon: Icon, label, path }) => (
              <button
                key={path}
                onClick={() => handleMoreItemClick(path)}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${
                  isActive(path)
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                <Icon size={20} />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default MobileBottomNav;
