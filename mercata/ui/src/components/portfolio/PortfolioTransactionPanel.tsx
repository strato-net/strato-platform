import { useMemo } from "react";
import type { Event } from "@mercata/shared-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PortfolioGroupActivity from "./PortfolioGroupActivity";
import type { PortfolioGroup } from "@/interface/portfolio";

interface Props {
  /** The group whose assets' transactions to show; null when nothing selected. */
  selectedGroup: PortfolioGroup | null;
  events: Event[];
  loading: boolean;
}

const norm = (v?: string | null): string =>
  (v || "").toLowerCase().replace(/^0x/, "");

/**
 * Side panel that shows the transaction history for the currently selected
 * asset group in the "Assets by Category" list.
 */
const PortfolioTransactionPanel = ({ selectedGroup, events, loading }: Props) => {
  const addresses = useMemo(
    () => (selectedGroup?.positions.map((p) => norm(p.address)).filter(Boolean)) ?? [],
    [selectedGroup]
  );

  return (
    <Card className="rounded-xl shadow-sm mb-6 h-full">
      <CardHeader className="pb-2 md:pb-4">
        <CardTitle className="text-base md:text-lg font-semibold">
          Transaction History
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {selectedGroup ? selectedGroup.label : "Select an asset to view its activity"}
        </p>
      </CardHeader>
      <CardContent className="px-3 md:px-4">
        {!selectedGroup ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Select an asset from the list to see its transactions.
          </div>
        ) : (
          <PortfolioGroupActivity
            addresses={addresses}
            events={events}
            loading={loading}
            limit={25}
            hideHeader
          />
        )}
      </CardContent>
    </Card>
  );
};

export default PortfolioTransactionPanel;
