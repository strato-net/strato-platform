
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DollarSign, ArrowDown, ArrowUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const LendingPoolSection = () => {
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  
  // USDST lending pool data
  const poolData = {
    name: "USDST Lending Pool",
    symbol: "USDST",
    apr: "5.2%",
    totalDeposits: "$432,891.45",
    userDeposit: "$1,245.00",
    rewards: "$12.53"
  };

  const handleDeposit = () => {
    console.log("Depositing:", depositAmount);
    // Reset input after deposit
    setDepositAmount("");
    // In a real app, you would connect to the blockchain here
  };

  const handleWithdraw = () => {
    console.log("Withdrawing:", withdrawAmount);
    // Reset input after withdraw
    setWithdrawAmount("");
    // In a real app, you would connect to the blockchain here
  };

  return (
    <div>
      <Card className="mb-6">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>{poolData.name}</CardTitle>
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info size={16} className="text-gray-400 cursor-help mr-1" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">Deposit USDST to earn interest from borrowers. Your funds are used to provide liquidity for the STRATO protocol.</p>
                </TooltipContent>
              </Tooltip>
              <span className="bg-green-100 text-green-700 text-sm px-2 py-1 rounded-md font-medium">
                APR: {poolData.apr}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-4 border">
              <div className="flex justify-between mb-4">
                <h3 className="font-medium">Pool Stats</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total deposits</span>
                  <span className="font-medium">{poolData.totalDeposits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Your deposit</span>
                  <span className="font-medium">{poolData.userDeposit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Earned rewards</span>
                  <span className="font-medium text-green-600">{poolData.rewards}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex flex-col space-y-4">
                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Deposit</h3>
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className="pl-8"
                      />
                      <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    </div>
                    <Button 
                      onClick={handleDeposit} 
                      className="bg-strato-blue hover:bg-strato-blue/90"
                      disabled={!depositAmount || parseFloat(depositAmount) <= 0}
                    >
                      <ArrowDown className="mr-2 h-4 w-4" />
                      Deposit
                    </Button>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Withdraw</h3>
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        className="pl-8"
                      />
                      <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    </div>
                    <Button 
                      onClick={handleWithdraw}
                      variant="outline"
                      className="border-strato-blue text-strato-blue hover:bg-strato-blue/10"
                      disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0}
                    >
                      <ArrowUp className="mr-2 h-4 w-4" />
                      Withdraw
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LendingPoolSection;
