
import { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from 'lucide-react';
import Lottie from 'react-lottie-player';
import confettiAnimation from '../../assets/confetti-animation.json';

interface ClaimGiftProps {
  onClaim: () => void;
  isMobile: boolean;
}

const ClaimGift: React.FC<ClaimGiftProps> = ({ onClaim, isMobile }) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in with a slight delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  const handleClaim = () => {
    setShowConfetti(true);
    setTimeout(() => {
      onClaim();
    }, 1500); // Allow confetti to play before moving to next step
  };

  return (
    <div className={`relative w-full max-w-md transition-all duration-500 transform ${
      isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    } ${isMobile ? 'h-full' : ''}`}>
      {showConfetti && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <Lottie
            loop={false}
            animationData={confettiAnimation}
            play
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}

      <Card className={`overflow-hidden shadow-lg border-2 border-strato-blue/20 ${
        isMobile ? 'h-full flex flex-col' : ''
      }`}>
        <CardHeader className="bg-gradient-to-r from-strato-blue to-strato-purple text-white text-center pb-6">
          <div className="mx-auto mb-2">
            <Sparkles size={40} className="text-yellow-200" />
          </div>
          <CardTitle className="text-2xl font-bold">Welcome Gift!</CardTitle>
        </CardHeader>
        <CardContent className={`pt-6 text-center ${isMobile ? 'flex-1 flex flex-col justify-center' : ''}`}>
          <div className="text-4xl font-bold text-strato-blue mb-3">$5 USDST</div>
          <p className="text-gray-600 mb-6">
            Start your journey with some funds on us!
            Try the platform risk-free.
          </p>
          <div className="p-3 rounded-lg bg-yellow-50 text-amber-700 text-sm mb-2">
            This token represents stable USD value in the STRATO ecosystem
          </div>
        </CardContent>
        <CardFooter className={`flex justify-center ${
          isMobile ? 'pb-10' : ''
        }`}>
          <Button 
            onClick={handleClaim}
            size="lg" 
            className="bg-strato-blue hover:bg-strato-blue/90 text-white font-semibold px-8 py-6 h-auto"
          >
            Add to Wallet
          </Button>
        </CardFooter>
      </Card>
      
      {isMobile && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <div className="h-1.5 w-10 bg-gray-300 rounded-full animate-pulse" />
          <div className="mt-2 text-xs text-gray-400">Swipe up to claim</div>
        </div>
      )}
    </div>
  );
};

export default ClaimGift;
