
import { Bell, User, Copy } from 'lucide-react';
import { Button } from "../ui/button";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface DashboardHeaderProps {
  title: string;
}

const DashboardHeader = ({ title }: DashboardHeaderProps) => {
  const [copied, setCopied] = useState(false);
  const username = "cryptoTrader";
  const walletAddress = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const truncateAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  return (
    <header className="bg-white border-b border-gray-100 py-4 px-6 flex items-center justify-between">
      <h1 className="text-xl font-bold">{title}</h1>
      
      <div className="flex items-center space-x-4">
        <div className="relative">
          <button className="p-2 rounded-full hover:bg-gray-100 transition-colors">
            <Bell size={20} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
        </div>
        
        <div className="flex items-center">
          <div className="flex flex-col items-end mr-3">
            <span className="text-sm font-medium">{username}</span>
            <div className="flex items-center">
              <span className="text-xs text-gray-500">{truncateAddress(walletAddress)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button 
                    onClick={copyToClipboard} 
                    className="ml-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Copy size={12} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{copied ? "Copied!" : "Copy address"}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <Avatar className="w-8 h-8 bg-gradient-to-r from-strato-blue to-strato-purple">
            <AvatarFallback className="text-white text-xs">
              {username.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
