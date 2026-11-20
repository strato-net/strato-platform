import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { RewardsConverterToken } from "@strato/shared-types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, LoadingRow, PaginationControls, PaginationInfo } from "@/components/common/HistoryTable";
import { useRewardsConverterAccount, useRewardsConverterHistory } from "@/hooks/useRewardsConverter";
import { formatBalance } from "@/utils/numberUtils";
import RateValue from "./RateValue";

const ITEMS_PER_PAGE = 10;
const COLUMN_COUNT = 4;

const formatTimestamp = (timestamp: string) =>
  new Date(timestamp).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

interface ConversionHistoryProps {
  rewardsToken: RewardsConverterToken;
  stratoToken: RewardsConverterToken;
}

/** The signed-in account's conversions and lifetime totals; nothing is requested until it is expanded. */
const ConversionHistory = ({ rewardsToken, stratoToken }: ConversionHistoryProps) => {
  const [open, setOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const { data: account } = useRewardsConverterAccount();
  const history = useRewardsConverterHistory({ page: currentPage, limit: ITEMS_PER_PAGE, enabled: open });

  const conversions = history.data?.data ?? [];
  const totalCount = history.data?.totalCount ?? 0;
  const loading = history.isFetching;

  const formatConverted = (value: string) =>
    formatBalance(value, rewardsToken.symbol, rewardsToken.decimals, 2, 6);
  const formatReceived = (value: string) =>
    formatBalance(value, stratoToken.symbol, stratoToken.decimals, 2, 6);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-4">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full flex items-center justify-start gap-2 px-2">
          <span className="text-lg font-semibold">Conversion History</span>
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4">
        {account && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-2 text-sm text-muted-foreground">
            <span>
              Total converted:{" "}
              <span className="font-medium text-foreground">{formatConverted(account.totalConverted)}</span>
            </span>
            <span>
              Total received:{" "}
              <span className="font-medium text-foreground">{formatReceived(account.totalReceived)}</span>
            </span>
          </div>
        )}

        <div className="bg-card rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Time</TableHead>
                <TableHead className="w-[120px]">Converted</TableHead>
                <TableHead className="w-[120px]">Received</TableHead>
                <TableHead className="w-[100px]">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={`transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
              {history.isLoading ? (
                <LoadingRow colSpan={COLUMN_COUNT} />
              ) : conversions.length > 0 ? (
                conversions.map((conversion) => (
                  <TableRow key={conversion.transactionHash}>
                    <TableCell className="text-sm">{formatTimestamp(conversion.timestamp)}</TableCell>
                    <TableCell className="text-sm">{formatConverted(conversion.converted)}</TableCell>
                    <TableCell className="text-sm">{formatReceived(conversion.received)}</TableCell>
                    <TableCell className="text-sm">
                      <RateValue rate={conversion.rate} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyRow colSpan={COLUMN_COUNT} message="No conversions yet" />
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <PaginationInfo
              currentPage={currentPage}
              itemsPerPage={ITEMS_PER_PAGE}
              totalCount={totalCount}
              pageLength={conversions.length}
              noun="conversion"
            />
            <PaginationControls
              currentPage={currentPage}
              totalPages={Math.ceil(totalCount / ITEMS_PER_PAGE)}
              loading={loading}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ConversionHistory;
