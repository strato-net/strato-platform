
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";

interface BorrowUSDSTProps {
  onBorrow: () => void;
  assets: {
    usdst: number;
    goldst: number;
    cata: number;
    borrowed: number;
  };
  isMobile: boolean;
}

const BorrowUSDST: React.FC<BorrowUSDSTProps> = ({ onBorrow, assets, isMobile }) => {
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
          <CardTitle className="text-xl text-center">Borrow Against Your GOLDST</CardTitle>
        </CardHeader>
        
        <CardContent className="pt-6">
          <div className="text-center mb-6">
            <div className="text-sm text-gray-500 mb-1">Borrow Amount</div>
            <div className="font-bold text-4xl text-strato-blue">$1.00 USDST</div>
          </div>
          
          <div className="mb-8">
            <div className="flex justify-between mb-2 text-sm">
              <span>Amount</span>
              <span className="font-medium">$1.00</span>
            </div>
            <Slider 
              value={[1]} 
              max={3}
              step={0.1}
              disabled
              className="cursor-not-allowed"
            />
            <div className="flex justify-between mt-1 text-xs text-gray-500">
              <span>$0.00</span>
              <span>$3.00</span>
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-lg border mb-6">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-medium">Collateral</div>
              <div className="text-sm font-medium">0.003 GOLDST</div>
            </div>
            
            <div className="mb-2">
              <div className="flex justify-between text-sm">
                <span>Risk Level</span>
                <span className="text-green-600 font-medium">Safe (5%)</span>
              </div>
              <div className="mt-1 h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-green-400" 
                  style={{ width: '5%' }}
                />
              </div>
            </div>
            
            <div className="text-xs text-gray-500 mt-2">
              Utilization: 5% of available credit
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">
            Borrow stable tokens against your vaulted assets with no repayment schedule
          </div>
        </CardContent>
        
        <CardFooter className="border-t p-4 flex justify-center">
          <Button 
            onClick={onBorrow}
            size="lg" 
            className="bg-strato-purple hover:bg-strato-purple/90 text-white font-semibold px-8 w-full"
          >
            Confirm Borrow
          </Button>
        </CardFooter>
      </Card>
      
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 px-4 py-4 bg-gradient-to-t from-gray-50 to-transparent">
          <Progress value={5} className="mb-4" />
          <Button 
            onClick={onBorrow}
            size="lg" 
            className="bg-strato-purple hover:bg-strato-purple/90 text-white font-semibold w-full py-6 h-auto"
          >
            Confirm Borrow
          </Button>
        </div>
      )}
    </div>
  );
};

export default BorrowUSDST;
