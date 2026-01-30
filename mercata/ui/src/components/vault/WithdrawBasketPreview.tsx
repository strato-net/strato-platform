import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUnits } from "ethers";

export interface BasketItem {
  address: string;
  symbol: string;
  name: string;
  weightPercent: string;
  usdValue: string;
  tokenAmount: string;
  included: boolean;
  images?: { value: string }[];
}

interface WithdrawBasketPreviewProps {
  basket: BasketItem[];
  totalUsd: string;
}

const formatTokenAmount = (value: string, decimals: number = 18): string => {
  try {
    const num = parseFloat(formatUnits(value, decimals));
    if (num === 0) return "0";
    if (num < 0.0001) return "<0.0001";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  } catch {
    return "0";
  }
};

const formatUsd = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value, 18));
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const formatPercent = (value: string): string => {
  try {
    const num = parseFloat(value);
    if (num === 0) return "0";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  } catch {
    return "0";
  }
};

const WithdrawBasketPreview = ({ basket, totalUsd }: WithdrawBasketPreviewProps) => {
  const includedItems = basket.filter((item) => item.included);

  if (includedItems.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        No tokens available for withdrawal.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">
        You will receive
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">USD Value</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {includedItems.map((item) => (
              <TableRow key={item.address}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {item.images?.[0]?.value ? (
                      <img
                        src={item.images[0].value}
                        alt={item.symbol}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs text-white font-medium">
                        {item.symbol?.slice(0, 2)}
                      </div>
                    )}
                    <span className="font-medium">{item.symbol}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercent(item.weightPercent)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${formatUsd(item.usdValue)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatTokenAmount(item.tokenAmount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      <div className="flex justify-between items-center pt-2 border-t">
        <span className="font-medium">Total Value</span>
        <span className="text-lg font-bold">${formatUsd(totalUsd)}</span>
      </div>
    </div>
  );
};

export default WithdrawBasketPreview;
