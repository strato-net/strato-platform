
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Copy, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';

interface WalletData {
  username: string;
  blockchainAccount: string;
  privateKey: string;
}

const WalletCreated = () => {
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [copiedKeys, setCopiedKeys] = useState<{[key: string]: boolean}>({
    username: false,
    blockchainAccount: false,
    privateKey: false
  });
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  useEffect(() => {
    document.title = "Wallet Created | STRATO Mercata";
    
    // Get data from location state or use placeholder data
    const data = location.state?.walletData || {
      username: "demo_user",
      blockchainAccount: "0x7f3b54c9b17C124322bB1f5c9F8CF9F836fB75e9",
      privateKey: "ea67f37b390cf41985f7e55848d8ef4bca9658aac28d53167f909e61d331dbce"
    };
    
    setWalletData(data);
  }, [location.state]);

  const handleCopy = (field: string, value: string) => {
    navigator.clipboard.writeText(value);
    
    // Update copied status for this field
    setCopiedKeys(prev => ({...prev, [field]: true}));
    
    toast({
      title: "Copied!",
      description: `${field} has been copied to clipboard.`
    });
    
    // Reset copied status after 2 seconds
    setTimeout(() => {
      setCopiedKeys(prev => ({...prev, [field]: false}));
    }, 2000);
  };
  
  const handleContinue = () => {
    // Show confirmation dialog if user hasn't copied private key
    if (!copiedKeys.privateKey && !confirmDialogOpen) {
      setConfirmDialogOpen(true);
      return;
    }
    
    navigate('/onboarding', { state: { walletData } });
  };

  if (!walletData) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="max-w-xl mx-auto">
          <Card className="border-2 border-strato-blue/20">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-strato-blue to-strato-purple flex items-center justify-center">
                  <Shield className="h-8 w-8 text-white" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-gray-800">Wallet Created Successfully!</CardTitle>
              <CardDescription className="text-gray-600 mt-2">
                Your STRATO Mercata wallet has been created. Please save your credentials below in a secure location.
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-gray-700">Username</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleCopy("Username", walletData.username)}
                    className={copiedKeys.username ? "text-green-600" : "text-gray-500"}
                  >
                    <Copy className="h-4 w-4 mr-1" /> {copiedKeys.username ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="font-mono bg-white p-2 rounded-md border border-gray-200 text-gray-800 break-all">
                  {walletData.username}
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-gray-700">Blockchain Account</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleCopy("Blockchain Account", walletData.blockchainAccount)}
                    className={copiedKeys.blockchainAccount ? "text-green-600" : "text-gray-500"}
                  >
                    <Copy className="h-4 w-4 mr-1" /> {copiedKeys.blockchainAccount ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="font-mono bg-white p-2 rounded-md border border-gray-200 text-gray-800 break-all">
                  {walletData.blockchainAccount}
                </div>
              </div>
              
              <div className="bg-red-50 p-4 rounded-lg border border-red-200 hover:bg-red-100 transition-colors">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-red-700">Private Key <span className="text-red-600 font-bold">*</span></span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleCopy("Private Key", walletData.privateKey)}
                    className={copiedKeys.privateKey ? "text-green-600" : "text-red-500"}
                  >
                    <Copy className="h-4 w-4 mr-1" /> {copiedKeys.privateKey ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="font-mono bg-white p-2 rounded-md border border-red-200 text-gray-800 break-all">
                  {walletData.privateKey}
                </div>
                <p className="text-xs text-red-600 mt-2">
                  <span className="font-bold">WARNING:</span> Never share your private key! Anyone with this key can access and transfer all your assets.
                </p>
              </div>
            </CardContent>
            
            <CardFooter className="flex flex-col gap-4 pt-2">
              <p className="text-amber-600 text-sm">
                <span className="font-semibold">Important:</span> We cannot recover your private key. Make sure to back it up somewhere safe.
              </p>
              <Button 
                className="w-full bg-strato-blue hover:bg-strato-blue/90 text-white"
                onClick={handleContinue}
              >
                Start Onboarding <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
      
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Private Key Not Copied!</DialogTitle>
            <DialogDescription>
              You haven't copied your private key. If you lose this key, you won't be able to access your wallet. We strongly recommend copying and storing it securely before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Go Back and Copy
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                setConfirmDialogOpen(false);
                navigate('/onboarding', { state: { walletData } });
              }}
            >
              Continue Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WalletCreated;
