import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import OpenJuniorNoteWidget from "./OpenJuniorNoteWidget";
import JuniorNotesList from "./JuniorNotesList";
import { BadDebt } from "@/services/cdpService";

interface JuniorNotesViewProps {
  badDebtData: BadDebt[];
  onBadDebtUpdate?: () => void; // Callback to refresh bad debt data
}

const JuniorNotesView: React.FC<JuniorNotesViewProps> = ({ badDebtData, onBadDebtUpdate }) => {
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
    <div className="space-y-6">
      {/* Overview Section */}
      <Card>
        <CardHeader>
          <CardTitle>Junior Notes - Bad Debt Recovery</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              <strong>Junior Notes</strong> allow you to participate in bad debt recovery by burning USDST 
              for a premium return when the system recovers funds.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
              <h4 className="font-medium text-blue-900 mb-2">How it works:</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• <strong>Burn USDST:</strong> Burn your USDST to open a junior note with a 10% premium cap</li>
                <li>• <strong>Earn Rewards:</strong> Receive proportional share of recovered bad debt funds</li>
                <li>• <strong>Claim Anytime:</strong> Claim your accumulated rewards as funds flow into the reserve</li>
                <li>• <strong>Risk/Reward:</strong> Higher returns but dependent on successful bad debt recovery</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Tabs */}
      <Tabs defaultValue="claim" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="claim">My Junior Note</TabsTrigger>
          <TabsTrigger value="open">Cover Bad Debt</TabsTrigger>
        </TabsList>
        
        <TabsContent value="claim" className="space-y-4">
          <JuniorNotesList 
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
        <CardHeader>
          <CardTitle className="text-lg">Important Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Premium Structure</h4>
                <p className="text-gray-600">
                  Burn 1,000 USDST → Get 1,100 USDST cap (10% premium)
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Reward Distribution</h4>
                <p className="text-gray-600">
                  Rewards are distributed proportionally based on your note size
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Risk Factors</h4>
                <p className="text-gray-600">
                  Returns depend on successful liquidations and bad debt recovery
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Note Behavior</h4>
                <p className="text-gray-600">
                  Notes can be topped up and close automatically when fully claimed
                </p>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start space-x-2">
              <div className="w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center mt-0.5">
                <span className="text-white text-xs font-bold">!</span>
              </div>
              <div className="text-sm">
                <p className="font-medium text-yellow-900">Risk Warning</p>
                <p className="text-yellow-800">
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

export default JuniorNotesView;
