
import { Avatar, AvatarFallback } from "../ui/avatar";
import { useUser } from '@/context/UserContext';
import CopyButton from '../ui/copy';

interface DashboardHeaderProps {
  title: string;
}

const DashboardHeader = ({ title }: DashboardHeaderProps) => {
  const { userAddress, userName } = useUser()

  const truncateAddress = (address: string) => {
    return `${address?.substring(0, 6)}...${address?.substring(address.length - 4)}`;
  };

  return (
    <header className="bg-white border-b border-gray-100 py-4 px-6 flex items-center justify-between">
      <h1 className="text-xl font-bold">{title}</h1>

      <div className="flex items-center space-x-4">
        <div className="flex items-center">
          <div className="flex flex-col items-end mr-3">
            <span className="text-sm font-medium">{userName || "N/A"}</span>
            <div className="flex items-center">
              <span className="text-xs text-gray-500">{userAddress ? truncateAddress(userAddress) : "N/A"}</span>
              <CopyButton address={userAddress}/>
            </div>
          </div>
          <Avatar className="w-8 h-8 bg-strato-blue">
            <AvatarFallback className="text-white text-xs bg-strato-blue">
              {userName.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
