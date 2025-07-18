import { Avatar, AvatarFallback } from "../ui/avatar";
import { useUser } from '@/context/UserContext';
import CopyButton from '../ui/copy';
import { truncateAddress } from "@/utils/numberUtils";
import { LogOutIcon, Menu } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface DashboardHeaderProps {
  title: string;
  onMenuClick?: () => void;
}

const DashboardHeader = ({ title, onMenuClick }: DashboardHeaderProps) => {
  const { userAddress, userName, logout } = useUser()

  const getAvatarFallback = () => {
    if (!userName) return "NA";
    return userName.substring(0, 2).toUpperCase();
  };

  return (
    <header className="bg-white border-b border-gray-100 py-4 px-6 flex items-center justify-between">
      <div className="flex items-center">
        <button
          onClick={onMenuClick}
          className="md:hidden mr-4 p-2 hover:bg-gray-100 rounded-md"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-xl font-bold">{title}</h1>
      </div>

      <div className="flex items-center space-x-4">
        <div className="flex items-center">
          <div className="flex flex-col items-end mr-3">
            <span className="text-sm font-medium">{userName || "N/A"}</span>
            <div className="flex items-center">
              <span className="text-xs text-gray-500">{truncateAddress(userAddress)}</span>
              <CopyButton address={userAddress}/>
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Avatar className="w-8 h-8 bg-strato-blue cursor-pointer">
                <AvatarFallback className="text-white text-xs bg-strato-blue">
                  {getAvatarFallback()}
                </AvatarFallback>
              </Avatar>
            </PopoverTrigger>
            <PopoverContent className="w-full p-3 shadow-md mt-2" align="end" side="bottom">
              <div className="flex flex-col space-y-0.5">
                <div className="text-sm font-medium">{userName || "N/A"}</div>
                <div className="text-xs text-gray-600 break-all !mb-1">
                  {truncateAddress(userAddress, 16, 8)}
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={logout}
                >
                  <LogOutIcon />
                  Logout
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
