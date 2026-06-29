import { useState } from "react";
import { Menu } from "lucide-react";
import { ModeToggle } from "@/components/ModeToggle";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { SidebarNav } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function Header() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      {/* Mobile: hamburger + logo (no "Management" word — keeps room for the wallet widget) */}
      <div className="flex items-center gap-2 md:hidden">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="flex h-16 flex-row items-center border-b border-sidebar-border px-4">
              <SheetTitle className="text-left">
                <BrandMark />
              </SheetTitle>
            </SheetHeader>
            <SidebarNav onNavigate={() => setNavOpen(false)} />
            <div className="border-t border-sidebar-border p-3">
              <ModeToggle />
            </div>
          </SheetContent>
        </Sheet>
        <BrandMark showLabel={false} />
      </div>

      <div className="hidden md:block">
        <ExplorerSearch />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {/* Theme toggle lives in the mobile drawer; hide it here to avoid overlapping the wallet widget */}
        <div className="hidden md:block">
          <ModeToggle />
        </div>
        <ConnectWalletButton />
      </div>
    </header>
  );
}

import stratoLogo from "@/assets/strato.png";
import stratoDarkLogo from "@/assets/strato-dark.png";

export function BrandMark({ showLabel = true }: { showLabel?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src={stratoLogo} alt="STRATO" className="h-7 w-auto dark:hidden" />
      <img src={stratoDarkLogo} alt="STRATO" className="hidden h-7 w-auto dark:block" />
      {showLabel ? (
        <span className="text-sm font-semibold text-muted-foreground">Management</span>
      ) : null}
    </div>
  );
}
