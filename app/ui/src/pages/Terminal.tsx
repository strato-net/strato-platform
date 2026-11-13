import { useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Market } from "@/interface";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMarkets, useMarketStats, useTradeSettling } from "@/hooks/terminal/useMarketData";
import { MarketHeader } from "@/components/terminal/MarketHeader";
import { PriceChart } from "@/components/terminal/PriceChart";
import { DepthLadder } from "@/components/terminal/DepthLadder";
import { TradesTape } from "@/components/terminal/TradesTape";
import { OrderForm } from "@/components/terminal/OrderForm";
import { BottomPanel } from "@/components/terminal/BottomPanel";
import { Tabs } from "@/components/terminal/Tabs";

// below this width the three columns no longer fit beside the sidebar
const DESKTOP_QUERY = "(min-width: 1180px)";
const subscribeToDesktop = (onChange: () => void) => {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** The order book and the trades share one panel, a tab each */
const book = (market: Market) => (
  <Tabs
    tabs={[
      { name: "Order book", content: <DepthLadder market={market} /> },
      { name: "Trades", content: <TradesTape market={market} /> },
    ]}
  />
);

const Terminal = () => {
  usePageTitle("Terminal");
  const { pair } = useParams();
  const isDesktop = useSyncExternalStore(subscribeToDesktop, () => window.matchMedia(DESKTOP_QUERY).matches);
  const { data: markets, isLoading } = useMarkets();
  const market = markets?.find((m) => m.id.toLowerCase() === pair?.toLowerCase()) ?? markets?.[0];
  const { data: stats } = useMarketStats(market?.poolAddress);
  const settlement = useTradeSettling(market?.poolAddress);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Terminal" />
        {!market ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {isLoading ? "Loading markets…" : "No markets are available on this network"}
          </p>
        ) : isDesktop ? (
          // header is h-20; the terminal fills the rest of the viewport
          <main className="flex h-[calc(100vh-5rem)] flex-col">
            <MarketHeader market={market} markets={markets!} stats={stats} />
            <ResizablePanelGroup direction="vertical" autoSaveId="terminal-rows" className="min-h-0 flex-1">
              <ResizablePanel defaultSize={72} minSize={40}>
                <ResizablePanelGroup direction="horizontal" autoSaveId="terminal-columns">
                  <ResizablePanel defaultSize={50} minSize={30}>
                    <PriceChart poolAddress={market.poolAddress} />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={22} minSize={16}>
                    {book(market)}
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={28} minSize={18}>
                    <OrderForm key={market.id} market={market} settlement={settlement} />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={28} minSize={10}>
                <BottomPanel market={market} price={stats?.price} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>
        ) : (
          <main className="flex flex-col divide-y divide-border">
            <MarketHeader market={market} markets={markets!} stats={stats} />
            <div className="h-96">
              <PriceChart poolAddress={market.poolAddress} />
            </div>
            <OrderForm key={market.id} market={market} settlement={settlement} />
            <div className="h-[28rem]">{book(market)}</div>
            <div className="h-64">
              <BottomPanel market={market} price={stats?.price} />
            </div>
          </main>
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Terminal;
