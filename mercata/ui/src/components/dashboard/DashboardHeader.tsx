import { Avatar, AvatarFallback } from "../ui/avatar";
import { useUser } from '@/context/UserContext';
import CopyButton from '../ui/copy';
import { Menu } from 'lucide-react';
import { truncateAddress } from "@/utils/numberUtils";

interface DashboardHeaderProps {
  title: string;
  onMenuClick?: () => void;
}

const DashboardHeader = ({ title, onMenuClick }: DashboardHeaderProps) => {
  const { userAddress, userName } = useUser()
   
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
          <Avatar className="w-8 h-8 bg-strato-blue">
            <AvatarFallback className="text-white text-xs bg-strato-blue">
              {getAvatarFallback()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
