import { Loader2, RefreshCw, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUnits } from "ethers";
import { useVaultContext } from "@/context/VaultContext";

const formatTimestamp = (timestamp: string): string => {
  if (!timestamp) return "N/A";
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "N/A";
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

const VaultUserActivity = () => {
  const { vaultState, refreshUserActivity } = useVaultContext();
  const { userActivity, loadingUserActivity } = vaultState;

  const handleRefresh = () => {
    refreshUserActivity(false);
  };

  if (loadingUserActivity && userActivity.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Your Activity</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={loadingUserActivity}
        >
          <RefreshCw className={`h-4 w-4 ${loadingUserActivity ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {userActivity.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No deposits or withdrawals yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userActivity.map((item, idx) => (
                  <TableRow key={`${item.type}-${item.timestamp}-${idx}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {item.type === "deposit" ? (
                          <ArrowDownToLine className="h-4 w-4 text-green-600" />
                        ) : (
                          <ArrowUpFromLine className="h-4 w-4 text-red-600" />
                        )}
                        <Badge variant={item.type === "deposit" ? "default" : "secondary"}>
                          {item.type === "deposit" ? "Deposit" : "Withdraw"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(item.timestamp)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${formatUsd(item.valueUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VaultUserActivity;
