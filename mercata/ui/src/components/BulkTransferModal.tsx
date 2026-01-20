import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import { TRANSFER_FEE } from "@/lib/constants";
import { isAddress } from "ethers";
import { Upload, X, AlertCircle, CheckCircle2, XCircle, Download } from "lucide-react";
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
  to: string;
  amount: string;
  error?: string;
}

interface BulkTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromAsset: Token | undefined;
  userAddress: string | undefined;
  maxBalance: string;
  onConfirm: (transfers: BulkTransferItem[]) => Promise<BulkTransferResponse>;
}

type ModalState = "upload" | "preview" | "processing" | "results";

const BulkTransferModal = ({
  open,
  onOpenChange,
  fromAsset,
  userAddress,
  maxBalance,
  onConfirm,
}: BulkTransferModalProps) => {
  const [modalState, setModalState] = useState<ModalState>("upload");
  const [parsedTransfers, setParsedTransfers] = useState<ParsedTransfer[]>([]);
  const [results, setResults] = useState<BulkTransferResult[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetModal = useCallback(() => {
    setModalState("upload");
    setParsedTransfers([]);
    setResults([]);
    setSuccessCount(0);
    setFailureCount(0);
    setProcessing(false);
    setCurrentIndex(0);
  }, []);

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      resetModal();
    }
    onOpenChange(open);
  }, [onOpenChange, resetModal]);

  const validateTransfer = useCallback((to: string, amount: string, index: number): ParsedTransfer => {
    const errors: string[] = [];

    // Validate address
    const trimmedTo = to.trim();
    if (!trimmedTo) {
      errors.push("Missing recipient address");
    } else if (!isAddress(trimmedTo.startsWith("0x") ? trimmedTo : `0x${trimmedTo}`)) {
      errors.push("Invalid address format");
    } else if (userAddress && trimmedTo.toLowerCase() === userAddress.toLowerCase()) {
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
      to: trimmedTo,
      amount: trimmedAmount,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }, [userAddress]);

  const parseCSV = useCallback((content: string): ParsedTransfer[] => {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    const transfers: ParsedTransfer[] = [];

    // Skip header row if it looks like a header
    let startIndex = 0;
    if (lines.length > 0) {
      const firstLine = lines[0].toLowerCase();
      if (firstLine.includes("address") || firstLine.includes("recipient") || firstLine.includes("to") || firstLine.includes("amount")) {
        startIndex = 1;
      }
    }

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split by comma, handling potential quoted values
      const parts = line.split(",").map(p => p.trim().replace(/^["']|["']$/g, ""));

      if (parts.length >= 2) {
        const [to, amount] = parts;
        transfers.push(validateTransfer(to, amount, i - startIndex));
      } else {
        transfers.push({
          to: parts[0] || "",
          amount: "",
          error: "Invalid CSV format - expected: address,amount",
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

  const totalAmount = validTransfers.reduce((sum, t) => {
    return sum + safeParseUnits(t.amount, 18);
  }, 0n);

  const totalFee = BigInt(validTransfers.length) * safeParseUnits(TRANSFER_FEE, 18);
  const maxBalanceWei = BigInt(maxBalance || "0");

  const hasInsufficientBalance = totalAmount > maxBalanceWei;

  const handleConfirmTransfer = async () => {
    if (validTransfers.length === 0) return;

    setModalState("processing");
    setProcessing(true);
    setCurrentIndex(0);

    try {
      const transferItems: BulkTransferItem[] = validTransfers.map(t => ({
        to: t.to,
        value: safeParseUnits(t.amount, 18).toString(),
      }));

      const response = await onConfirm(transferItems);

      setResults(response.results);
      setSuccessCount(response.successCount);
      setFailureCount(response.failureCount);
      setModalState("results");
    } catch (error: any) {
      console.error("Bulk transfer error:", error);
      setModalState("results");
      setFailureCount(validTransfers.length);
    } finally {
      setProcessing(false);
    }
  };

  const downloadTemplate = () => {
    const template = "recipient_address,amount\n0x1234567890123456789012345678901234567890,100\n0xabcdefabcdefabcdefabcdefabcdefabcdefabcd,50";
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_transfer_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadResults = () => {
    const headers = "recipient_address,amount,status,hash,error\n";
    const rows = results.map(r =>
      `${r.to},${formatBalance(r.value, undefined, 18)},${r.status},${r.hash || ""},${r.error || ""}`
    ).join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_transfer_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderUploadState = () => (
    <>
      <DialogHeader>
        <DialogTitle>Bulk Transfer</DialogTitle>
        <DialogDescription>
          Upload a CSV file to transfer {fromAsset?.token?._symbol || fromAsset?.token?._name} to multiple recipients.
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
            Your CSV file should have two columns: recipient_address, amount
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            Example: 0x1234...abcd, 100
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
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedTransfers.map((transfer, index) => (
                <TableRow key={index} className={transfer.error ? "bg-red-50 dark:bg-red-950/20" : ""}>
                  <TableCell className="font-mono text-xs">{index + 1}</TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-[200px]" title={transfer.to}>
                    {transfer.to.length > 20 ? `${transfer.to.slice(0, 10)}...${transfer.to.slice(-8)}` : transfer.to}
                  </TableCell>
                  <TableCell className="text-right">{transfer.amount}</TableCell>
                  <TableCell>
                    {transfer.error ? (
                      <span className="flex items-center text-red-600 text-xs">
                        <XCircle className="h-4 w-4 mr-1" />
                        <span className="truncate max-w-[80px]" title={transfer.error}>Error</span>
                      </span>
                    ) : (
                      <span className="flex items-center text-green-600 text-xs">
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Valid
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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
              Insufficient balance. Total: {formatBalance(totalAmount, undefined, 18, 0, 4)}, Available: {formatBalance(maxBalanceWei, undefined, 18, 0, 4)}
            </p>
          </div>
        )}

        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Valid Transfers</span>
            <span className="font-medium">{validTransfers.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Amount</span>
            <span className="font-medium">
              {formatBalance(totalAmount, fromAsset?.token?._symbol || fromAsset?.token?._name, 18, 0, 4)}
            </span>
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

  const renderProcessingState = () => (
    <>
      <DialogHeader>
        <DialogTitle>Processing Transfers</DialogTitle>
        <DialogDescription>
          Please wait while your transfers are being processed...
        </DialogDescription>
      </DialogHeader>

      <div className="py-8 text-center">
        <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">
          Processing transfers...
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Do not close this window
        </p>
      </div>
    </>
  );

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
                <TableHead>Recipient</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result, index) => (
                <TableRow key={index}>
                  <TableCell className="font-mono text-xs truncate max-w-[150px]" title={result.to}>
                    {result.to.length > 16 ? `${result.to.slice(0, 8)}...${result.to.slice(-6)}` : result.to}
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
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        <Button
          variant="outline"
          onClick={downloadResults}
          className="w-full"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Results
        </Button>
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
