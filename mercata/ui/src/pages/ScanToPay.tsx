import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Token } from "@/interface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { QRCode } from "antd";
import { Html5Qrcode } from "html5-qrcode";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { handleAmountInputChange } from "@/utils/transferValidation";
import { sortTokensCompareFn } from "@/lib/tokenPriority";
import { addCommasToInput } from "@/utils/numberUtils";

const ScanToPay = () => {
  const navigate = useNavigate();
  const { userAddress } = useUser();
  const { getTransferableTokens } = useTokenContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"receive" | "scan">("receive");

  // Receive tab state
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedToken, setSelectedToken] = useState<Token>();
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [tokenPopoverOpen, setTokenPopoverOpen] = useState(false);
  const [showInactiveTokens, setShowInactiveTokens] = useState(false);

  // Scan tab state
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-reader";
  const isScannerRunningRef = useRef(false);

  useEffect(() => {
    document.title = "Scan to Pay | STRATO";
  }, []);

  const fetchTokens = useCallback(async () => {
    try {
      const tokens = await getTransferableTokens();
      setTokens(tokens);
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
    }
  }, [getTransferableTokens]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const { activeTokens, inactiveTokens } = useMemo(() => {
    const active = tokens.filter(token => token.token?.status === '2');
    const inactive = tokens.filter(token => token.token?.status !== '2');
    active.sort(sortTokensCompareFn);
    inactive.sort(sortTokensCompareFn);
    return { activeTokens: active, inactiveTokens: inactive };
  }, [tokens]);

  // Generate QR code URL
  const qrValue = useMemo(() => {
    if (!selectedToken || !amount || !userAddress) return "";
    const params = new URLSearchParams({
      token: selectedToken.address,
      amount: amount,
      to: userAddress,
      symbol: selectedToken.token?._symbol || selectedToken.token?._name || "",
    });
    return `${window.location.origin}/dashboard/transfer?${params.toString()}`;
  }, [selectedToken, amount, userAddress]);

  // Scanner functions
  const handleScanSuccess = useCallback((decodedText: string) => {
    try {
      const url = new URL(decodedText);
      if (url.pathname === "/dashboard/transfer") {
        navigate(`${url.pathname}${url.search}`);
      } else {
        setScanError("Invalid QR code");
      }
    } catch {
      setScanError("Invalid QR code format");
    }
  }, [navigate, setScanError]);

  const startScanner = useCallback(async () => {
    setScanError("");
    try {
      const html5Qrcode = new Html5Qrcode(scannerContainerId);
      scannerRef.current = html5Qrcode;

      await html5Qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          isScannerRunningRef.current = false;
          html5Qrcode.stop().catch(() => {});
          setScanning(false);
          handleScanSuccess(decodedText);
        },
        () => {}
      );
      isScannerRunningRef.current = true;
      setScanning(true);
    } catch (err) {
      isScannerRunningRef.current = false;
      setScanError("Failed to access camera");
      console.error("Scanner error:", err);
    }
  }, [handleScanSuccess, setScanError, setScanning]);

  const stopScanner = useCallback(() => {
    if (scannerRef.current && isScannerRunningRef.current) {
      isScannerRunningRef.current = false;
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current && isScannerRunningRef.current) {
        isScannerRunningRef.current = false;
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "scan") {
      stopScanner();
    }
  }, [activeTab, stopScanner]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Scan to Pay" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-card shadow-md rounded-lg p-6 border border-border">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as "receive" | "scan")}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="receive">Receive</TabsTrigger>
                <TabsTrigger value="scan">Scan</TabsTrigger>
              </TabsList>

              <TabsContent value="receive" className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Generate a QR code for others to scan and pay you.
                </p>

                {/* Token selector */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Token to Receive</label>
                  <Popover
                    open={tokenPopoverOpen}
                    onOpenChange={(open) => {
                      setTokenPopoverOpen(open);
                      if (!open) setShowInactiveTokens(false);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full flex justify-between items-center"
                      >
                        <span>
                          {selectedToken
                            ? selectedToken?.token?._symbol || selectedToken?.token?._name
                            : "Select Token"}
                        </span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <div className="flex flex-col max-h-72 overflow-y-auto">
                        {tokens.length > 0 ? (
                          <>
                            {activeTokens.map((token) => (
                              <Button
                                key={token.address}
                                variant="ghost"
                                className="justify-start"
                                onClick={() => {
                                  setSelectedToken(token);
                                  setTokenPopoverOpen(false);
                                }}
                              >
                                {token?.token?._symbol || token?.token?._name}
                              </Button>
                            ))}
                            {inactiveTokens.length > 0 && !showInactiveTokens && (
                              <Button
                                variant="ghost"
                                className="justify-center text-muted-foreground hover:text-foreground border-t"
                                onClick={() => setShowInactiveTokens(true)}
                              >
                                Show More ({inactiveTokens.length})
                              </Button>
                            )}
                            {showInactiveTokens && inactiveTokens.map((token) => (
                              <Button
                                key={token.address}
                                variant="ghost"
                                className="justify-start text-muted-foreground"
                                onClick={() => {
                                  setSelectedToken(token);
                                  setTokenPopoverOpen(false);
                                }}
                              >
                                {token?.token?._symbol || token?.token?._name}
                              </Button>
                            ))}
                            {showInactiveTokens && inactiveTokens.length > 0 && (
                              <Button
                                variant="ghost"
                                className="justify-center text-muted-foreground hover:text-foreground border-t"
                                onClick={() => setShowInactiveTokens(false)}
                              >
                                Show Less
                              </Button>
                            )}
                          </>
                        ) : (
                          <span className="p-2 text-sm text-muted-foreground">
                            No tokens available
                          </span>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={addCommasToInput(amount)}
                    onChange={(e) => {
                      handleAmountInputChange(e.target.value, setAmount, setAmountError, undefined, 18);
                    }}
                    placeholder="0.00"
                    className={`w-full p-2 border rounded ${amountError ? "border-red-500" : ""}`}
                  />
                  {amountError && (
                    <p className="text-red-600 text-sm">{amountError}</p>
                  )}
                </div>

                {/* QR Code Display */}
                {qrValue && (
                  <div className="flex flex-col items-center space-y-4 pt-4">
                    <div className="p-4 bg-white rounded-lg">
                      <QRCode value={qrValue} size={200} />
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      Scan this QR code to send {amount} {selectedToken?.token?._symbol || selectedToken?.token?._name}
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="scan" className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Scan a payment QR code to auto-fill a transfer.
                </p>

                <div className="flex flex-col items-center space-y-4">
                  <div
                    id={scannerContainerId}
                    className="w-full max-w-sm aspect-square bg-muted rounded-lg overflow-hidden"
                  />

                  {scanError && (
                    <p className="text-red-600 text-sm">{scanError}</p>
                  )}

                  <Button
                    onClick={scanning ? stopScanner : startScanner}
                    variant={scanning ? "destructive" : "default"}
                    className="w-full max-w-sm"
                  >
                    {scanning ? "Stop Scanner" : "Start Scanner"}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ScanToPay;
