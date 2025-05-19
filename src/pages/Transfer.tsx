import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import api from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { parseUnits, formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";

const Transfer = () => {
  const { userAddress } = useUser();
  const { toast } = useToast();
  useEffect(() => {
    document.title = "Transfer Assets | STRATO Mercata";
  }, []);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [recipient, setRecipient] = useState<string>("");

  const [fromAsset, setFromAsset] = useState<Token>();
  const [fromAmount, setFromAmount] = useState("");
  const [swapLoading, setSwapLoading] = useState<boolean>(false);
  const [wrongAmount, setWrongAmount] = useState(false);
  const [tokenPopoverOpen, setTokenPopoverOpen] = useState(false);

  const maxAmount = fromAsset ? Number(formatUnits(fromAsset.value, 18)) : 0;

  useEffect(() => {
    api
      .get(`/tokens/table/balance?key=eq.${userAddress}&value=gt.0`)
      .then((res) => setTokens(res.data))
      .catch(console.error);
  }, [userAddress]);

  const handleTransfer = async () => {
    if (!fromAsset || !recipient || !fromAmount) return;
    try {
      setSwapLoading(true);
      await api.post("/tokens/transfer", {
        address: fromAsset.address,
        to: recipient,
        value: parseUnits(fromAmount, 18).toString(),
      });
      toast({
        title: "Success",
        description: `Transferred ${fromAmount} ${
          fromAsset["BlockApps-Mercata-ERC20"]?._symbol ||
          fromAsset["BlockApps-Mercata-ERC20"]?._name
        } to ${recipient}`,
      });
      setFromAmount("");
      setRecipient("");
    } catch (error) {
      toast({
        title: "Error",
        description: "Transfer failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSwapLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      <div className="flex-1 ml-64">
        <DashboardHeader title="Transfer Assets" />
        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 space-y-6">
            <h2 className="text-xl font-semibold">Transfer your tokens</h2>

            {/* Token selector */}
            <div className="space-y-2">
              <label className="text-sm text-gray-600">Token</label>
              <Popover
                open={tokenPopoverOpen}
                onOpenChange={setTokenPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full flex justify-between items-center"
                  >
                    <span>
                      {fromAsset
                        ? fromAsset["BlockApps-Mercata-ERC20"]?._symbol ||
                          fromAsset["BlockApps-Mercata-ERC20"]?._name
                        : "Select Token"}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <div className="flex flex-col">
                    {tokens.length > 0 ? (
                      tokens.map((token) => (
                        <Button
                          key={token.address}
                          variant="ghost"
                          className="justify-start"
                          onClick={() => {
                            setFromAsset(token);
                            setFromAmount("");
                            setTokenPopoverOpen(false);
                          }}
                        >
                          {token["BlockApps-Mercata-ERC20"]?._symbol ||
                            fromAsset["BlockApps-Mercata-ERC20"]?._name}
                        </Button>
                      ))
                    ) : (
                      <span className="p-2 text-sm text-gray-500">
                        No tokens available
                      </span>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Recipient Address */}
            <div className="space-y-2">
              <label className="text-sm text-gray-600">Recipient Address</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="..."
                className="w-full p-2 border rounded"
              />
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="text-sm text-gray-600">
                Amount
                {fromAsset
                  ? ` (Max: ${maxAmount.toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    })})`
                  : ""}
              </label>
              <input
                type="number"
                value={fromAmount}
                onChange={(e) => {
                  const v = e.target.value;
                  setFromAmount(v);
                  const num = Number(v);
                  setWrongAmount(num <= 0 || num > maxAmount);
                }}
                placeholder="0.00"
                className={`w-full p-2 border rounded ${
                  wrongAmount ? "border-red-500" : ""
                }`}
              />
              {wrongAmount && (
                <p className="text-red-600 text-sm">
                  Amount must be greater than zero and no more than your
                  available balance.
                </p>
              )}
            </div>

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={handleTransfer}
              disabled={
                !fromAsset ||
                !recipient ||
                !fromAmount ||
                wrongAmount ||
                swapLoading
              }
            >
              {swapLoading ? <span>Processing…</span> : "Transfer"}
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Transfer;
