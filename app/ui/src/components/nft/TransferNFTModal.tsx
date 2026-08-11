import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useNFTContext } from "@/context/NFTContext";
import { NFTItem } from "@strato/shared-types";

const ADDRESS_RE = /^(0x)?[a-fA-F0-9]{40}$/;

const TransferNFTModal = ({
  item,
  open,
  onOpenChange,
  onTransferred,
  warning,
}: {
  item: NFTItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransferred: () => void;
  /** kind-specific consequence note (e.g. a position NFT moves its liquidity too) */
  warning?: string;
}) => {
  const { transferNFT } = useNFTContext();
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid = ADDRESS_RE.test(to.trim());

  const handleTransfer = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await transferNFT({
        collectionAddress: item.collection.address,
        to: to.trim(),
        tokenId: item.tokenId,
      });
      toast({
        title: "NFT transferred",
        description: `${item.collection.symbol} #${item.tokenId} sent to ${to.trim().slice(0, 10)}…`,
      });
      onOpenChange(false);
      setTo("");
      onTransferred();
    } catch (error) {
      const err = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
      toast({
        title: "Transfer failed",
        // errorHandler nests the message at data.error.message
        description: err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Transfer {item.collection.symbol} #{item.tokenId}
          </DialogTitle>
          <DialogDescription>
            Transfers are permanent — the recipient becomes the sole owner of this NFT.
          </DialogDescription>
        </DialogHeader>
        {warning && <p className="text-yellow-600 text-xs md:text-sm">⚠️ {warning}</p>}
        <div className="space-y-2">
          <Label htmlFor="nft-transfer-to">Recipient address</Label>
          <Input
            id="nft-transfer-to"
            placeholder="0x…"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            autoComplete="off"
          />
          {to && !valid && (
            <p className="text-xs text-destructive">Enter a valid 40-character hex address.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleTransfer} disabled={!valid || submitting}>
            {submitting ? "Transferring…" : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferNFTModal;
