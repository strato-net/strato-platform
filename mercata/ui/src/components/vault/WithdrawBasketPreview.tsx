import { Check, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
  const skippedItems = basket.filter((item) => !item.included);

  if (basket.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        No withdrawal basket to display.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">
        Withdrawal Basket Preview
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">USD Value</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Included items */}
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
                <TableCell className="text-center">
                  <Badge variant="default" className="gap-1">
                    <Check className="h-3 w-3" />
                    Included
                  </Badge>
                </TableCell>
              </TableRow>
            ))}

            {/* Skipped items (grayed out) */}
            {skippedItems.map((item) => (
              <TableRow key={item.address} className="opacity-50">
                <TableCell>
                  <div className="flex items-center gap-2">
                    {item.images?.[0]?.value ? (
                      <img
                        src={item.images[0].value}
                        alt={item.symbol}
                        className="w-6 h-6 rounded-full object-cover grayscale"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center text-xs text-white font-medium">
                        {item.symbol?.slice(0, 2)}
                      </div>
                    )}
                    <span className="font-medium text-muted-foreground">{item.symbol}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatPercent(item.weightPercent)}%
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  $0.00
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  0
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary" className="gap-1">
                    <X className="h-3 w-3" />
                    At Reserve
                  </Badge>
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

      {skippedItems.length > 0 && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <strong>Note:</strong> {skippedItems.length} token{skippedItems.length > 1 ? "s" : ""} skipped
          because they are at minimum reserve levels. Your withdrawal will be distributed among
          available tokens proportionally.
        </div>
      )}
    </div>
  );
};

export default WithdrawBasketPreview;
