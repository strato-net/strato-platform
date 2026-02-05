import { LogIn } from 'lucide-react';
import { useTheme } from 'next-themes';

interface GuestSignInBannerProps {
  message: string;
}

const GuestSignInBanner = ({ message }: GuestSignInBannerProps) => {
  const { theme } = useTheme();

  const handleSignIn = () => {
    window.location.href = `/login?theme=${theme}`;
  };

  return (
    <div 
      onClick={handleSignIn}
      className="block mb-4 md:mb-6 cursor-pointer"
    >
      <div className="bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 flex items-center justify-between hover:bg-blue-500/15 transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 rounded-full p-1.5 flex-shrink-0">
            <LogIn className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm md:text-base font-medium text-foreground">
            {message}
          </span>
        </div>
        <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold hover:underline flex-shrink-0">
          Sign In →
        </span>
      </div>
    </div>
  );
};

export default GuestSignInBanner;
