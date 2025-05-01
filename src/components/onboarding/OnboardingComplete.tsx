
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Confetti } from 'lucide-react';
import Lottie from 'react-lottie-player';
import confettiAnimation from '../../assets/confetti-animation.json';

interface OnboardingCompleteProps {
  onComplete: () => void;
  assets: {
    usdst: number;
    goldst: number;
    cata: number;
    borrowed: number;
  };
  isMobile: boolean;
}

const OnboardingComplete: React.FC<OnboardingCompleteProps> = ({ 
  onComplete, 
  assets,
  isMobile 
}) => {
  const [showConfetti, setShowConfetti] = useState(true);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in with a slight delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`relative w-full max-w-md transition-all duration-500 transform ${
      isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    }`}>
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

      <Card className="shadow-lg border-2 border-strato-purple/30">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-r from-strato-blue to-strato-purple flex items-center justify-center">
              <Confetti size={40} className="text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Trial Complete!</CardTitle>
        </CardHeader>
        
        <CardContent className="text-center">
          <Badge className="bg-strato-purple hover:bg-strato-purple/90 text-white px-4 py-1.5 text-sm mb-6 mx-auto">
            You've earned {assets.cata.toFixed(2)} CATA!
          </Badge>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg border">
              <div className="text-sm text-gray-500">USDST Balance</div>
              <div className="font-bold text-lg">${assets.usdst.toFixed(2)}</div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border">
              <div className="text-sm text-gray-500">GOLDST</div>
              <div className="font-bold text-lg">{assets.goldst.toFixed(3)}</div>
            </div>
          </div>
          
          <div className="bg-green-50 rounded-lg p-4 border border-green-100 text-left mb-6">
            <div className="font-semibold text-green-800 mb-1">What you've accomplished:</div>
            <ul className="text-sm text-green-700 space-y-1">
              <li>✓ Claimed welcome bonus</li>
              <li>✓ Purchased gold-backed tokens</li>
              <li>✓ Borrowed against your assets</li>
              <li>✓ Started earning CATA rewards</li>
            </ul>
          </div>
        </CardContent>
        
        <CardFooter className="flex justify-center">
          <Button 
            onClick={onComplete}
            size="lg" 
            className="bg-strato-blue hover:bg-strato-blue/90 text-white font-semibold px-8"
          >
            Go to Dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default OnboardingComplete;
