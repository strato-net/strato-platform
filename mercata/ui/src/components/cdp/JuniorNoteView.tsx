import React, { useState } from "react";
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
  const [activeTab, setActiveTab] = useState<'claim' | 'open'>('claim');

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
    <div className="space-y-3 md:space-y-6">
      {/* Overview Section */}
      <Card className="rounded-none md:rounded-xl border-x-0 md:border-x">
        <CardHeader className="px-3 md:px-6 py-3 md:py-6">
          <CardTitle className="text-sm md:text-lg whitespace-nowrap">Junior Notes - Bad Debt Recovery</CardTitle>
        </CardHeader>
        <CardContent className="px-3 md:px-6 pb-3 md:pb-6 pt-0">
          <div className="text-xs md:text-sm text-muted-foreground space-y-2">
            <p>
              <strong className="text-foreground">Junior Notes</strong> allow you to participate in bad debt recovery by burning USDST 
              for a premium return when the system recovers funds.
            </p>
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-2 md:p-3 mt-2 md:mt-3">
              <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-1.5 md:mb-2 text-xs md:text-sm">How it works:</h4>
              <ul className="text-[11px] md:text-sm text-blue-800 dark:text-blue-200 space-y-0.5 md:space-y-1">
                <li>• <strong className="text-blue-900 dark:text-blue-300">Burn USDST:</strong> Burn your USDST to open a junior note with a 10% premium cap</li>
                <li>• <strong className="text-blue-900 dark:text-blue-300">Earn Rewards:</strong> Receive proportional share of recovered bad debt funds</li>
                <li>• <strong className="text-blue-900 dark:text-blue-300">Claim Anytime:</strong> Claim your accumulated rewards as funds flow into the reserve</li>
                <li>• <strong className="text-blue-900 dark:text-blue-300">Risk/Reward:</strong> Higher returns but dependent on successful bad debt recovery</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Tabs - Underline Style */}
      <div className="flex border-b border-border mb-3 md:mb-4">
        <button
          onClick={() => setActiveTab('claim')}
          className={`flex-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'claim'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          My Junior Note
        </button>
        <button
          onClick={() => setActiveTab('open')}
          className={`flex-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'open'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Cover Bad Debt
        </button>
      </div>

      {activeTab === 'claim' && (
        <div className="space-y-3 md:space-y-4">
          <JuniorNote 
            refreshTrigger={refreshTrigger}
            onNoteActionSuccess={handleNoteActionSuccess}
          />
        </div>
      )}

      {activeTab === 'open' && (
        <div className="space-y-3 md:space-y-4">
          <OpenJuniorNoteWidget 
            onSuccess={handleNoteOpened} 
            assetBadDebt={assetBadDebtMap}
            onBadDebtCovered={onBadDebtUpdate}
          />
        </div>
      )}

      {/* Additional Information */}
      <Card className="rounded-none md:rounded-xl border-x-0 md:border-x">
        <CardHeader className="px-3 md:px-6 py-3 md:py-6">
          <CardTitle className="text-sm md:text-lg whitespace-nowrap">Important Information</CardTitle>
        </CardHeader>
        <CardContent className="px-3 md:px-6 pb-3 md:pb-6 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-xs md:text-sm">
            <div className="space-y-2 md:space-y-3">
              <div>
                <h4 className="font-medium text-foreground mb-0.5 md:mb-1 text-xs md:text-sm">Premium Structure</h4>
                <p className="text-muted-foreground text-[11px] md:text-sm">
                  Burn 1,000 USDST → Get 1,100 USDST cap (10% premium)
                </p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-0.5 md:mb-1 text-xs md:text-sm">Reward Distribution</h4>
                <p className="text-muted-foreground text-[11px] md:text-sm">
                  Rewards are distributed proportionally based on your note size
                </p>
              </div>
            </div>
            <div className="space-y-2 md:space-y-3">
              <div>
                <h4 className="font-medium text-foreground mb-0.5 md:mb-1 text-xs md:text-sm">Risk Factors</h4>
                <p className="text-muted-foreground text-[11px] md:text-sm">
                  Returns depend on successful liquidations and bad debt recovery
                </p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-0.5 md:mb-1 text-xs md:text-sm">Note Behavior</h4>
                <p className="text-muted-foreground text-[11px] md:text-sm">
                  Notes can be topped up and close automatically when fully claimed
                </p>
              </div>
            </div>
          </div>
          
          <div className="mt-3 md:mt-4 p-2 md:p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg">
            <div className="flex items-start space-x-2">
              <div className="w-3.5 h-3.5 md:w-4 md:h-4 bg-yellow-500 dark:bg-yellow-600 rounded-full flex items-center justify-center mt-0.5 shrink-0">
                <span className="text-white text-[10px] md:text-xs font-bold">!</span>
              </div>
              <div className="text-sm">
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
