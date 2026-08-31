import { Wallet } from 'lucide-react';
import { requestWalletConnection } from '@/lib/auth';

interface GuestSignInBannerProps {
  message: string;
}

const GuestSignInBanner = ({ message }: GuestSignInBannerProps) => {
  const handleSignIn = () => {
    requestWalletConnection();
  };

  return (
    <div 
      onClick={handleSignIn}
      className="block mb-4 md:mb-6 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/30 rounded-lg px-4 py-3 flex items-center justify-between hover:bg-primary/15 transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-primary rounded-full p-1.5 flex-shrink-0">
            <Wallet className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-sm md:text-base font-medium text-foreground">
            {message}
          </span>
        </div>
        <span className="text-primary text-sm font-semibold hover:underline flex-shrink-0">
          Connect Wallet →
        </span>
      </div>
    </div>
  );
};

export default GuestSignInBanner;
