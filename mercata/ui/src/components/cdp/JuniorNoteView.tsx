import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import OpenJuniorNoteWidget from "./OpenJuniorNoteWidget";
import JuniorNote from "./JuniorNote";
import { BadDebt } from "@/services/cdpService";

interface JuniorNoteViewProps {
  badDebtData: BadDebt[];
  onBadDebtUpdate?: () => void; // Callback to refresh bad debt data
}

const JuniorNoteView: React.FC<JuniorNoteViewProps> = ({ badDebtData, onBadDebtUpdate }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Convert BadDebt array to Record<string, string> format for easier lookup
  const assetBadDebtMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    badDebtData.forEach(item => {
      map[item.asset] = item.badDebt;
    });
    return map;
  }, [badDebtData]);

  // Callback to refresh notes list when a note is opened
  const handleNoteOpened = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Callback to refresh when note actions succeed
  const handleNoteActionSuccess = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Overview Section */}
      <Card>
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-4">
          <CardTitle className="text-base md:text-xl">Junior Notes - Bad Debt Recovery</CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="text-xs md:text-sm text-muted-foreground space-y-2">
            <p>
              <strong className="text-foreground">Junior Notes</strong> allow you to participate in bad debt recovery by burning USDST 
              for a premium return when the system recovers funds.
            </p>
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-2.5 md:p-3 mt-3">
              <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2 text-xs md:text-sm">How it works:</h4>
              <ul className="text-xs md:text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li>• <strong className="text-blue-900 dark:text-blue-300">Burn USDST:</strong> Burn your USDST to open a junior note with a 10% premium cap</li>
                <li>• <strong className="text-blue-900 dark:text-blue-300">Earn Rewards:</strong> Receive proportional share of recovered bad debt funds</li>
                <li>• <strong className="text-blue-900 dark:text-blue-300">Claim Anytime:</strong> Claim your accumulated rewards as funds flow into the reserve</li>
                <li>• <strong className="text-blue-900 dark:text-blue-300">Risk/Reward:</strong> Higher returns but dependent on successful bad debt recovery</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Tabs */}
      <Tabs defaultValue="claim" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-auto">
          <TabsTrigger value="claim" className="text-xs md:text-sm py-2">My Junior Note</TabsTrigger>
          <TabsTrigger value="open" className="text-xs md:text-sm py-2">Cover Bad Debt</TabsTrigger>
        </TabsList>
        
        <TabsContent value="claim" className="space-y-4">
          <JuniorNote 
            refreshTrigger={refreshTrigger}
            onNoteActionSuccess={handleNoteActionSuccess}
          />
        </TabsContent>
        
        <TabsContent value="open" className="space-y-4">
          <OpenJuniorNoteWidget 
            onSuccess={handleNoteOpened} 
            assetBadDebt={assetBadDebtMap}
            onBadDebtCovered={onBadDebtUpdate}
          />
        </TabsContent>
      </Tabs>

      {/* Additional Information */}
      <Card>
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-4">
          <CardTitle className="text-base md:text-lg">Important Information</CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-xs md:text-sm">
            <div className="space-y-2 md:space-y-3">
              <div>
                <h4 className="font-medium text-foreground mb-1">Premium Structure</h4>
                <p className="text-muted-foreground">
                  Burn 1,000 USDST → Get 1,100 USDST cap (10% premium)
                </p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-1">Reward Distribution</h4>
                <p className="text-muted-foreground">
                  Rewards are distributed proportionally based on your note size
                </p>
              </div>
            </div>
            <div className="space-y-2 md:space-y-3">
              <div>
                <h4 className="font-medium text-foreground mb-1">Risk Factors</h4>
                <p className="text-muted-foreground">
                  Returns depend on successful liquidations and bad debt recovery
                </p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-1">Note Behavior</h4>
                <p className="text-muted-foreground">
                  Notes can be topped up and close automatically when fully claimed
                </p>
              </div>
            </div>
          </div>
          
          <div className="mt-3 md:mt-4 p-2.5 md:p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg">
            <div className="flex items-start space-x-2">
              <div className="w-4 h-4 bg-yellow-500 dark:bg-yellow-600 rounded-full flex items-center justify-center mt-0.5 shrink-0">
                <span className="text-white text-xs font-bold">!</span>
              </div>
              <div className="text-xs md:text-sm">
                <p className="font-medium text-yellow-900 dark:text-yellow-400">Risk Warning</p>
                <p className="text-yellow-800 dark:text-yellow-300">
                  Junior notes are higher-risk investments. Only participate with funds you can afford to lose. 
                  Returns are not guaranteed and depend on system performance.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default JuniorNoteView;
