
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ClaimGift from '../components/onboarding/ClaimGift';
import BuyGoldST from '../components/onboarding/BuyGoldST';
import BorrowUSDST from '../components/onboarding/BorrowUSDST';
import ShareTheWealth from '../components/onboarding/ShareTheWealth';
import OnboardingComplete from '../components/onboarding/OnboardingComplete';
import OnboardingProgress from '../components/onboarding/OnboardingProgress';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';

// Onboarding steps
const STEPS = {
  CLAIM_GIFT: 0,
  BUY_GOLDST: 1,
  BORROW_USDST: 2,
  SHARE_WEALTH: 3,
  COMPLETE: 4
};

const Onboarding = () => {
  const [currentStep, setCurrentStep] = useState(STEPS.CLAIM_GIFT);
  const [walletData, setWalletData] = useState(null);
  const [assets, setAssets] = useState({
    usdst: 0,
    goldst: 0,
    cata: 0,
    borrowed: 0
  });
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  useEffect(() => {
    document.title = "Onboarding | STRATO Mercata";
    
    // Get wallet data from location state
    if (location.state?.walletData) {
      setWalletData(location.state.walletData);
    }
  }, [location.state]);
  
  const handleClaimGift = () => {
    // Add $5 USDST to wallet
    setAssets(prev => ({ ...prev, usdst: 5 }));
    toast({
      title: "Gift claimed!",
      description: "$5 USDST has been added to your wallet."
    });
    setCurrentStep(STEPS.BUY_GOLDST);
  };
  
  const handleBuyGoldST = () => {
    // Spend $5 USDST to get 0.003 GOLDST
    setAssets(prev => ({ 
      ...prev, 
      usdst: 0, 
      goldst: 0.003,
      cata: 0.01 // Start earning CATA
    }));
    toast({
      title: "Purchase successful!",
      description: "You've acquired 0.003 GOLDST"
    });
    setCurrentStep(STEPS.BORROW_USDST);
  };
  
  const handleBorrowUSDST = () => {
    // Borrow $1 USDST against GOLDST
    setAssets(prev => ({ 
      ...prev, 
      usdst: 1,
      borrowed: 1,
      cata: prev.cata + 0.09 // Add more CATA for completing
    }));
    toast({
      title: "Borrow successful!",
      description: "You've borrowed $1 USDST against your GOLDST"
    });
    setCurrentStep(STEPS.SHARE_WEALTH);
  };
  
  const handleShareWealth = (emailsSent: number) => {
    // Add CATA rewards for referrals (1 per email)
    const referralBonus = emailsSent * 1.0; // Changed from 0.05 to 1.0
    setAssets(prev => ({
      ...prev,
      cata: prev.cata + referralBonus
    }));
    
    if (emailsSent > 0) {
      toast({
        title: "Referrals sent!",
        description: `You earned ${referralBonus.toFixed(0)} CATA from your referrals.`
      });
    }
    
    setCurrentStep(STEPS.COMPLETE);
  };
  
  const handleComplete = () => {
    navigate('/dashboard', { 
      state: { 
        walletData,
        assets
      } 
    });
  };
  
  // Render the current step
  const renderStep = () => {
    switch(currentStep) {
      case STEPS.CLAIM_GIFT:
        return <ClaimGift onClaim={handleClaimGift} isMobile={isMobile} />;
      case STEPS.BUY_GOLDST:
        return <BuyGoldST onBuy={handleBuyGoldST} assets={assets} isMobile={isMobile} />;
      case STEPS.BORROW_USDST:
        return <BorrowUSDST onBorrow={handleBorrowUSDST} assets={assets} isMobile={isMobile} />;
      case STEPS.SHARE_WEALTH:
        return <ShareTheWealth onShare={handleShareWealth} assets={assets} isMobile={isMobile} />;
      case STEPS.COMPLETE:
        return <OnboardingComplete onComplete={handleComplete} assets={assets} isMobile={isMobile} />;
      default:
        return null;
    }
  };
  
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="container mx-auto px-4 py-8 flex-1 flex flex-col">
        <div className="mb-6">
          <OnboardingProgress currentStep={currentStep} totalSteps={4} />
        </div>
        
        <div className="flex-1 flex items-center justify-center">
          {renderStep()}
        </div>
        
        {currentStep > STEPS.CLAIM_GIFT && assets.cata > 0 && (
          <div className="fixed top-4 right-4 bg-strato-purple text-white px-4 py-2 rounded-full flex items-center gap-2 animate-fade-in shadow-lg">
            <span className="font-semibold">{assets.cata.toFixed(2)} CATA</span>
            <span className="text-xs text-white/70">earning</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
