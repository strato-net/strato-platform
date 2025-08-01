import React from 'react';
import { useConnect, useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface CustomConnectButtonProps {
  label?: string;
  className?: string;
}

const CustomConnectButton: React.FC<CustomConnectButtonProps> = ({ 
  label = "Connect Wallet", 
  className = "" 
}) => {
  const { connect, connectors, isPending } = useConnect();
  const { isConnected } = useAccount();
  const { toast } = useToast();

  const handleConnect = async () => {
    try {
      // Get the MetaMask connector (first connector in the array)
      const metaMaskConnector = connectors[0];
      
      if (!metaMaskConnector) {
        toast({
          title: "Connection Error",
          description: "MetaMask connector not found",
          variant: "destructive",
        });
        return;
      }

      await connect({ connector: metaMaskConnector });
    } catch (error: any) {
      console.error('Connection error:', error);
      
      // Check if MetaMask is not installed
      if (error.message?.includes('MetaMask not found') || 
          error.message?.includes('No provider') ||
          error.message?.includes('User rejected')) {
        toast({
          title: "MetaMask Required",
          description: "Please install MetaMask to connect your wallet",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Connection Failed",
          description: error.message || "Failed to connect wallet",
          variant: "destructive",
        });
      }
    }
  };

  // Don't render if already connected
  if (isConnected) {
    return null;
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={isPending}
      className={`bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 transition-all ${className}`}
    >
      {isPending ? "Connecting..." : label}
    </Button>
  );
};

export default CustomConnectButton; 