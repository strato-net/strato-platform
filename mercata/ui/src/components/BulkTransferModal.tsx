import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import { TRANSFER_FEE } from "@/lib/constants";
import { Upload, AlertCircle, CheckCircle2, XCircle, Download, Loader2, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { safeParseUnits, formatBalance } from "@/utils/numberUtils";
import { BulkTransferItem, BulkTransferResponse, BulkTransferResult } from "@/context/TokenContext";

interface ParsedTransfer {
  tokenAddress: string;
  to: string;
  amount: string;
  error?: string;
}

interface ProcessingTransfer {
  tokenAddress: string;
  to: string;
  amount: string;
  status: "pending" | "processing" | "success" | "failed";
  hash?: string;
  error?: string;
}

interface ExtendedBulkTransferResult extends BulkTransferResult {
  tokenAddress: string;
}

interface BulkTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userAddress: string | undefined;
  tokens: Token[];
  onConfirm: (tokenAddress: string, transfers: BulkTransferItem[]) => Promise<BulkTransferResponse>;
}

type ModalState = "upload" | "preview" | "processing" | "results";

const BulkTransferModal = ({
  open,
  onOpenChange,
  userAddress,
  tokens,
  onConfirm,
}: BulkTransferModalProps) => {
  const [modalState, setModalState] = useState<ModalState>("upload");
  const [parsedTransfers, setParsedTransfers] = useState<ParsedTransfer[]>([]);
  const [processingTransfers, setProcessingTransfers] = useState<ProcessingTransfer[]>([]);
  const [results, setResults] = useState<ExtendedBulkTransferResult[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetModal = useCallback(() => {
    setModalState("upload");
    setParsedTransfers([]);
    setProcessingTransfers([]);
    setResults([]);
    setSuccessCount(0);
    setFailureCount(0);
  }, []);

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      resetModal();
    }
    onOpenChange(open);
  }, [onOpenChange, resetModal]);

  // Validate address: 40 hex characters
  const isValidAddress = (addr: string): boolean => {
    return /^[a-fA-F0-9]{40}$/.test(addr);
  };

  const validateTransfer = useCallback((tokenAddress: string, to: string, amount: string): ParsedTransfer => {
    const errors: string[] = [];

    // Validate token address
    const normalizedTokenAddress = tokenAddress.trim().toLowerCase();
    if (!normalizedTokenAddress) {
      errors.push("Missing token address");
    } else if (!isValidAddress(normalizedTokenAddress)) {
      errors.push("Invalid token address");
    } else {
      // Check if user has this token
      const token = tokens.find(t => t.address.toLowerCase() === normalizedTokenAddress);
      if (!token) {
        errors.push("Token not in your wallet");
      }
    }

    // Validate recipient address
    const normalizedTo = to.trim().toLowerCase();
    if (!normalizedTo) {
      errors.push("Missing recipient address");
    } else if (!isValidAddress(normalizedTo)) {
      errors.push("Invalid address format");
    } else if (userAddress && normalizedTo === userAddress.toLowerCase()) {
      errors.push("Cannot transfer to self");
    }

    // Validate amount
    const trimmedAmount = amount.trim().replace(/,/g, "");
    if (!trimmedAmount) {
      errors.push("Missing amount");
    } else {
      const amountWei = safeParseUnits(trimmedAmount, 18);
      if (amountWei <= 0n) {
        errors.push("Amount must be greater than 0");
      }
    }

    return {
      tokenAddress: normalizedTokenAddress,
      to: normalizedTo,
      amount: trimmedAmount,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }, [userAddress, tokens]);

  const parseCSV = useCallback((content: string): ParsedTransfer[] => {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    const transfers: ParsedTransfer[] = [];

    // Skip header row if it looks like a header
    let startIndex = 0;
    if (lines.length > 0) {
      const firstLine = lines[0].toLowerCase();
      if (firstLine.includes("token") || firstLine.includes("address") || firstLine.includes("recipient") || firstLine.includes("to") || firstLine.includes("amount")) {
        startIndex = 1;
      }
    }

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split by comma, handling potential quoted values
      const parts = line.split(",").map(p => p.trim().replace(/^["']|["']$/g, ""));

      if (parts.length >= 3) {
        const [tokenAddress, to, amount] = parts;
        transfers.push(validateTransfer(tokenAddress, to, amount));
      } else {
        transfers.push({
          tokenAddress: parts[0] || "",
          to: parts[1] || "",
          amount: parts[2] || "",
          error: "Invalid CSV format - expected: token_address,recipient_address,amount",
        });
      }
    }

    return transfers;
  }, [validateTransfer]);

  const handleFileUpload = useCallback((file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      alert("Please upload a CSV file");
      return;
    }

    // Validate file size (max 1MB)
    if (file.size > 1024 * 1024) {
      alert("File size must be less than 1MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsed = parseCSV(content);

      if (parsed.length === 0) {
        alert("No valid transfers found in the CSV file");
        return;
      }

      if (parsed.length > 100) {
        alert("Maximum 100 transfers per batch allowed");
        return;
      }

      setParsedTransfers(parsed);
      setModalState("preview");
    };
    reader.readAsText(file);
  }, [parseCSV]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const validTransfers = parsedTransfers.filter(t => !t.error);
  const invalidTransfers = parsedTransfers.filter(t => t.error);

  // Group transfers by token address and calculate totals per token
  const transfersByToken = validTransfers.reduce((acc, t) => {
    const key = t.tokenAddress.toLowerCase();
    if (!acc[key]) {
      acc[key] = { transfers: [], total: 0n };
    }
    acc[key].transfers.push(t);
    acc[key].total += safeParseUnits(t.amount, 18);
    return acc;
  }, {} as Record<string, { transfers: ParsedTransfer[]; total: bigint }>);

  // Check for insufficient balance per token
  const insufficientBalanceTokens = Object.entries(transfersByToken).filter(([tokenAddress, data]) => {
    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress);
    if (!token) return true;
    const tokenBalance = BigInt(token.balance || "0");
    return data.total > tokenBalance;
  }).map(([tokenAddress]) => {
    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress);
    return token?.token?._symbol || token?.token?._name || tokenAddress.slice(0, 10) + "...";
  });

  const hasInsufficientBalance = insufficientBalanceTokens.length > 0;

  const totalFee = BigInt(validTransfers.length) * safeParseUnits(TRANSFER_FEE, 18);

  const handleConfirmTransfer = async () => {
    if (validTransfers.length === 0) return;

    // Initialize processing transfers with pending status
    const initialProcessing: ProcessingTransfer[] = validTransfers.map(t => ({
      tokenAddress: t.tokenAddress,
      to: t.to,
      amount: t.amount,
      status: "pending",
    }));
    setProcessingTransfers(initialProcessing);
    setModalState("processing");

    const allResults: ExtendedBulkTransferResult[] = [];
    let totalSuccess = 0;
    let totalFailure = 0;

    // Process transfers one at a time
    for (let i = 0; i < validTransfers.length; i++) {
      const transfer = validTransfers[i];

      // Update status to processing
      setProcessingTransfers(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: "processing" } : t
      ));

      try {
        const transferItem: BulkTransferItem = {
          to: transfer.to,
          value: safeParseUnits(transfer.amount, 18).toString(),
        };

        const response = await onConfirm(transfer.tokenAddress, [transferItem]);
        const result = response.results[0];

        // Update status based on result
        setProcessingTransfers(prev => prev.map((t, idx) =>
          idx === i ? {
            ...t,
            status: result.status === "success" ? "success" : "failed",
            hash: result.hash,
            error: result.error,
          } : t
        ));

        allResults.push({ ...result, tokenAddress: transfer.tokenAddress });
        if (result.status === "success") {
          totalSuccess++;
        } else {
          totalFailure++;
        }
      } catch (error) {
        console.error(`Transfer error for ${transfer.to}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Transfer failed";

        // Update status to failed
        setProcessingTransfers(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: "failed", error: errorMessage } : t
        ));

        allResults.push({
          to: transfer.to,
          value: safeParseUnits(transfer.amount, 18).toString(),
          status: "failed",
          error: errorMessage,
          tokenAddress: transfer.tokenAddress,
        });
        totalFailure++;
      }
    }

    setResults(allResults);
    setSuccessCount(totalSuccess);
    setFailureCount(totalFailure);
    setModalState("results");
  };

  const downloadTemplate = () => {
    const template = "token_address,recipient_address,amount";
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_transfer_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderUploadState = () => (
    <>
      <DialogHeader>
        <DialogTitle>Bulk Transfer</DialogTitle>
        <DialogDescription>
          Upload a CSV file to transfer tokens to multiple recipients.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragActive ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-border hover:border-muted-foreground"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            Drag and drop your CSV file here, or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            Maximum 100 transfers per batch
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>

        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <p className="text-sm font-medium">CSV Format</p>
          <p className="text-xs text-muted-foreground">
            Your CSV file should have three columns: token_address, recipient_address, amount
          </p>
          <p className="text-xs text-muted-foreground font-mono">
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            className="mt-2"
          >
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => handleClose(false)}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );

  const renderPreviewState = () => (
    <>
      <DialogHeader>
        <DialogTitle>Review Transfers</DialogTitle>
        <DialogDescription>
          Review the transfers before confirming. {invalidTransfers.length > 0 && (
            <span className="text-yellow-600">
              {invalidTransfers.length} invalid transfer(s) will be skipped.
            </span>
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <ScrollArea className="h-[300px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">#</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedTransfers.map((transfer, index) => {
                const token = tokens.find(t => t.address.toLowerCase() === transfer.tokenAddress.toLowerCase());
                const tokenName = token?.token?._symbol || token?.token?._name || transfer.tokenAddress.slice(0, 8) + "...";
                return (
                  <TableRow key={index} className={transfer.error ? "bg-red-50 dark:bg-red-950/20" : ""}>
                    <TableCell className="font-mono text-xs">{index + 1}</TableCell>
                    <TableCell className="text-xs truncate max-w-[100px]" title={transfer.tokenAddress}>
                      {tokenName}
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[150px]" title={transfer.to}>
                      {transfer.to.length > 16 ? `${transfer.to.slice(0, 8)}...${transfer.to.slice(-6)}` : transfer.to}
                    </TableCell>
                    <TableCell className="text-right text-sm">{transfer.amount}</TableCell>
                    <TableCell>
                      {transfer.error ? (
                        <span className="flex items-center text-red-600 text-xs">
                          <XCircle className="h-4 w-4 mr-1" />
                          <span className="truncate max-w-[60px]" title={transfer.error}>Error</span>
                        </span>
                      ) : (
                        <span className="flex items-center text-green-600 text-xs">
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Valid
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>

        {invalidTransfers.length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-950/20 p-3 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              {invalidTransfers.length} transfer(s) have errors and will be skipped
            </p>
          </div>
        )}

        {hasInsufficientBalance && (
          <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200 flex items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              Insufficient balance for: {insufficientBalanceTokens.join(", ")}
            </p>
          </div>
        )}

        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Valid Transfers</span>
            <span className="font-medium">{validTransfers.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tokens</span>
            <span className="font-medium">{Object.keys(transfersByToken).length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Fee ({validTransfers.length} x {TRANSFER_FEE} USDST)</span>
            <span className="font-medium">
              {formatBalance(totalFee, "USDST", 18, 2, 2)}
            </span>
          </div>
        </div>
      </div>

      <DialogFooter className="flex gap-2">
        <Button variant="outline" onClick={() => setModalState("upload")}>
          Back
        </Button>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={handleConfirmTransfer}
          disabled={validTransfers.length === 0 || hasInsufficientBalance}
        >
          Confirm {validTransfers.length} Transfer{validTransfers.length !== 1 ? "s" : ""}
        </Button>
      </DialogFooter>
    </>
  );

  const renderProcessingState = () => {
    const completed = processingTransfers.filter(t => t.status === "success" || t.status === "failed").length;
    const total = processingTransfers.length;

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            Processing Transfers
          </DialogTitle>
          <DialogDescription>
            {completed} of {total} transfers completed. Do not close this window.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <ScrollArea className="h-[300px]">
            <div className="space-y-2 pr-4">
              {processingTransfers.map((transfer, index) => {
                const token = tokens.find(t => t.address.toLowerCase() === transfer.tokenAddress.toLowerCase());
                const tokenName = token?.token?._symbol || token?.token?._name || transfer.tokenAddress.slice(0, 8) + "...";

                const getStatusIcon = () => {
                  switch (transfer.status) {
                    case "processing":
                      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
                    case "success":
                      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
                    case "failed":
                      return <XCircle className="h-4 w-4 text-red-500" />;
                    default:
                      return <Clock className="h-4 w-4 text-muted-foreground" />;
                  }
                };

                const getStatusBadge = () => {
                  switch (transfer.status) {
                    case "processing":
                      return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-500">Processing</span>;
                    case "success":
                      return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">Success</span>;
                    case "failed":
                      return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-500">Failed</span>;
                    default:
                      return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Pending</span>;
                  }
                };

                const getBorderClass = () => {
                  switch (transfer.status) {
                    case "processing":
                      return "border-blue-500/30 bg-blue-500/5";
                    case "success":
                      return "border-green-500/30 bg-green-500/5";
                    case "failed":
                      return "border-red-500/30 bg-red-500/5";
                    default:
                      return "border-border bg-muted/30";
                  }
                };

                return (
                  <div
                    key={index}
                    className={`rounded-lg border p-3 transition-all ${getBorderClass()}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0">{getStatusIcon()}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {transfer.amount} {tokenName}
                          </span>
                          {getStatusBadge()}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                          To: {transfer.to.slice(0, 8)}...{transfer.to.slice(-6)}
                        </p>
                        {transfer.hash && (
                          <p className="text-xs text-muted-foreground mt-1 font-mono">
                            Tx: {transfer.hash.slice(0, 10)}...{transfer.hash.slice(-8)}
                          </p>
                        )}
                        {transfer.error && (
                          <p className="text-xs text-red-500 mt-1">{transfer.error}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </>
    );
  };

  const renderResultsState = () => (
    <>
      <DialogHeader>
        <DialogTitle>Transfer Results</DialogTitle>
        <DialogDescription>
          {successCount} successful, {failureCount} failed
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg text-center">
            <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-green-600">{successCount}</p>
            <p className="text-sm text-muted-foreground">Successful</p>
          </div>
          <div className="bg-red-50 dark:bg-red-950/20 p-4 rounded-lg text-center">
            <XCircle className="h-8 w-8 text-red-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-red-600">{failureCount}</p>
            <p className="text-sm text-muted-foreground">Failed</p>
          </div>
        </div>

        <ScrollArea className="h-[200px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result, index) => {
                const token = tokens.find(t => t.address.toLowerCase() === result.tokenAddress.toLowerCase());
                const tokenName = token?.token?._symbol || token?.token?._name || result.tokenAddress.slice(0, 8) + "...";
                return (
                  <TableRow key={index}>
                    <TableCell className="text-xs truncate max-w-[80px]" title={result.tokenAddress}>
                      {tokenName}
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[120px]" title={result.to}>
                      {result.to.length > 14 ? `${result.to.slice(0, 6)}...${result.to.slice(-4)}` : result.to}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatBalance(result.value, undefined, 18, 0, 4)}
                    </TableCell>
                    <TableCell>
                      {result.status === "success" ? (
                        <span className="flex items-center text-green-600 text-xs">
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Success
                        </span>
                      ) : (
                        <span className="flex items-center text-red-600 text-xs" title={result.error}>
                          <XCircle className="h-4 w-4 mr-1" />
                          Failed
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <DialogFooter>
        <Button onClick={() => handleClose(false)}>
          Close
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {modalState === "upload" && renderUploadState()}
        {modalState === "preview" && renderPreviewState()}
        {modalState === "processing" && renderProcessingState()}
        {modalState === "results" && renderResultsState()}
      </DialogContent>
    </Dialog>
  );
};

export default BulkTransferModal;
