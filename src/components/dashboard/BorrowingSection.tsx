
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const BorrowingSection = () => {
  const riskPercentage = 36;
  
  return (
    <Card className="border border-gray-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-xl font-bold">Borrowing</CardTitle>
          <CardDescription className="text-gray-500">Leverage your assets with secured loans</CardDescription>
        </div>
        <div>
          <Button className="flex items-center gap-2">
            Start Borrowing <ArrowUpRight size={16} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="py-4">
          <div className="space-y-4">
            {/* Risk level bar moved to the top */}
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center">
                <span className="text-gray-600 mr-2">Risk Level:</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-600">
                  Moderate
                </span>
              </div>
              <span className="font-semibold">{riskPercentage}%</span>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
              <div className="bg-yellow-500 h-2 rounded-full" style={{ width: `${riskPercentage}%` }}></div>
            </div>
            
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Available Borrowing Power</span>
                <span className="font-semibold">$3,462.91</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Current Borrowed</span>
                <span className="font-semibold">$1,250.00</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Average Interest Rate</span>
                <span className="font-semibold">3.2% APR</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BorrowingSection;
