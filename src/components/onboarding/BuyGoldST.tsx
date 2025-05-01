
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowDown } from "lucide-react";

interface BuyGoldSTProps {
  onBuy: () => void;
  assets: {
    usdst: number;
    goldst: number;
    cata: number;
    borrowed: number;
  };
  isMobile: boolean;
}

const BuyGoldST: React.FC<BuyGoldSTProps> = ({ onBuy, assets, isMobile }) => {
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
      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
    }`}>
      <Card className={`shadow-lg border-2 border-strato-blue/20 ${
        isMobile ? 'mx-auto' : ''
      }`}>
        <CardHeader className="border-b">
          <CardTitle className="text-xl text-center">Buy GOLDST</CardTitle>
        </CardHeader>
        
        <CardContent className="pt-6">
          <div className="bg-white rounded-lg border p-4 mb-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-gray-500">From</div>
                <div className="font-bold text-lg">$5 USDST</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-strato-blue/10 flex items-center justify-center text-strato-blue">
                $
              </div>
            </div>
          </div>
          
          <div className="flex justify-center my-2">
            {isMobile ? (
              <ArrowDown className="text-gray-400" size={24} />
            ) : (
              <ArrowRight className="text-gray-400" size={24} />
            )}
          </div>
          
          <div className="bg-white rounded-lg border p-4 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-gray-500">To</div>
                <div className="font-bold text-lg">0.003 GOLDST</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-800">
                Au
              </div>
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-yellow-50 text-amber-700 text-sm mb-4">
            GOLDST represents physical gold stored in secure vaults
          </div>
          
          <div className="bg-green-50 rounded-lg p-3 border border-green-100">
            <div className="flex items-center text-sm text-green-700">
              <span className="font-medium">Benefits:</span>
              <span className="ml-2">Earn CATA rewards (≈ 0.01 CATA/min)</span>
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="border-t p-4 flex justify-center">
          <Button 
            onClick={onBuy}
            size="lg" 
            className="bg-strato-purple hover:bg-strato-purple/90 text-white font-semibold px-8 w-full"
          >
            Confirm Purchase
          </Button>
        </CardFooter>
      </Card>
      
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 py-6 px-4 bg-gradient-to-t from-gray-50 to-transparent">
          <Button 
            onClick={onBuy}
            size="lg" 
            className="bg-strato-purple hover:bg-strato-purple/90 text-white font-semibold w-full py-6 h-auto"
          >
            Confirm Purchase
          </Button>
        </div>
      )}
    </div>
  );
};

export default BuyGoldST;
