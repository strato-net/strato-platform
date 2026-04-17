import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type LoopMarketOption = {
  key: string;
  symbol: string;
  asset: string;
  netCarryAPR: number;
  maxLeverage: number;
  healthFactor: number;
};

interface MarketListProps {
  embedded: boolean;
  options: LoopMarketOption[];
  selectedKey: string;
  loading: boolean;
  error: boolean;
  onSelect: (option: LoopMarketOption) => void;
}

const MarketList = ({
  embedded,
  options,
  selectedKey,
  loading,
  error,
  onSelect,
}: MarketListProps) => (
  <Card className="border-border bg-card/80">
    <CardContent className="pt-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Loop markets</p>
          <p className="text-xs text-muted-foreground">
            {embedded
              ? "Pick a market to configure the trade panel"
              : "Pick a market to open its loop page"}
          </p>
        </div>
        {loading && options.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading loop markets...</div>
        ) : error ? (
          <div className="text-sm text-red-500">Failed to load loop markets. Please retry.</div>
        ) : options.length === 0 ? (
          <div className="text-sm text-muted-foreground">No loop markets available.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {options.map((option) => {
              const active = selectedKey === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onSelect(option)}
                  className={`rounded-md border p-3 text-left transition-all duration-200 ${
                    active
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{option.symbol}</div>
                    <Badge variant="outline">CDP</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p>APY</p>
                      <p className="text-foreground">
                        {option.netCarryAPR.toFixed(2)}%
                      </p>
                    </div>
                    <div>
                      <p>Max Lev</p>
                      <p className="text-foreground">
                        {option.maxLeverage.toFixed(1)}x
                      </p>
                    </div>
                    <div>
                      <p>Max-Lev Health</p>
                      <p className="text-foreground">
                        {option.healthFactor.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);

export default MarketList;
