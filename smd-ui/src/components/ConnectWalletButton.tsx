import { useAccount, useDisconnect } from "wagmi";
import { LogOut, Wallet, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@/context/UserContext";
import { requestWalletConnection } from "@/lib/auth";
import { shortenHex } from "@/lib/utils";

export function ConnectWalletButton() {
  const { userAddress, isLoggedIn, isAppAuthenticated, userName, logout } = useUser();
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);

  const connected = isLoggedIn || isConnected;

  if (!connected || !userAddress) {
    return (
      <Button onClick={requestWalletConnection} className="cta-button !py-2 !px-4 gap-2">
        <Wallet className="h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(userAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Wallet className="h-4 w-4" />
          {shortenHex(userAddress)}
          {isAppAuthenticated ? (
            <Badge variant="secondary" className="ml-1">STRATO</Badge>
          ) : (
            <Badge variant="outline" className="ml-1">External</Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="break-all text-xs font-normal">
          {userName ? <div className="mb-1 font-medium">{userName}</div> : null}
          {userAddress}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyAddress}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "Copied" : "Copy address"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => (isAppAuthenticated ? logout() : disconnect())}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {isAppAuthenticated ? "Log out" : "Disconnect"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
