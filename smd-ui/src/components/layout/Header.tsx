import { ModeToggle } from "@/components/ModeToggle";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="md:hidden">
        <BrandMark />
      </div>
      <div className="hidden md:block">
        <ExplorerSearch />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ModeToggle />
        <ConnectWalletButton />
      </div>
    </header>
  );
}

import stratoLogo from "@/assets/strato.png";
import stratoDarkLogo from "@/assets/strato-dark.png";

export function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <img src={stratoLogo} alt="STRATO" className="h-7 w-auto dark:hidden" />
      <img src={stratoDarkLogo} alt="STRATO" className="hidden h-7 w-auto dark:block" />
      <span className="text-sm font-semibold text-muted-foreground">Management</span>
    </div>
  );
}
