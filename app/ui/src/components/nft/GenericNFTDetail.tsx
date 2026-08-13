import { useState } from "react";
import { Send, Flame, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { useNFTContext } from "@/context/NFTContext";
import TransferNFTModal from "./TransferNFTModal";
import NFTThumbnail from "./NFTThumbnail";
import { NFTDetailRendererProps } from "./detailRenderers";

const normalize = (address?: string) => (address || "").toLowerCase().replace(/^0x/, "");

/**
 * Default detail renderer: collection image, identity, owner, raw tokenURI, and
 * owner-only transfer/burn. Deliberately does not fetch or interpret tokenURI JSON —
 * kind-specific renderers (e.g. the Phase 4 V3 position page) own their own presentation.
 */
const GenericNFTDetail = ({ item, onChanged }: NFTDetailRendererProps) => {
  const { userAddress } = useUser();
  const { burnNFT } = useNFTContext();
  const { toast } = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [burnOpen, setBurnOpen] = useState(false);
  const [burning, setBurning] = useState(false);

  const isOwner = normalize(userAddress) === normalize(item.owner);
  const title = `${item.collection.name || item.collection.symbol} #${item.tokenId}`;

  const handleBurn = async () => {
    setBurning(true);
    try {
      await burnNFT({ collectionAddress: item.collection.address, tokenId: item.tokenId });
      toast({
        title: "NFT burned",
        description: `${item.collection.symbol} #${item.tokenId} was permanently destroyed.`,
      });
      onChanged();
    } catch (error) {
      const err = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
      toast({
        title: "Burn failed",
        // errorHandler nests the message at data.error.message
        description: err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBurning(false);
      setBurnOpen(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
      {/* Image panel */}
      <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-center">
        <NFTThumbnail nft={item} className="w-40 h-40 text-2xl" />
      </div>

      {/* Info panel */}
      <div className="space-y-5 min-w-0">
        <div>
          <p className="text-sm text-muted-foreground">
            {item.collection.name} ({item.collection.symbol})
          </p>
          <h2 className="text-xl md:text-2xl font-semibold break-words">{title}</h2>
        </div>

        <div className="text-sm space-y-1.5">
          <div className="flex gap-2 min-w-0">
            <span className="text-muted-foreground flex-shrink-0">Owner</span>
            <span className="font-mono truncate">{item.owner}</span>
            {isOwner && <span className="text-xs text-strato-blue flex-shrink-0">(you)</span>}
          </div>
          <div className="flex gap-2 min-w-0">
            <span className="text-muted-foreground flex-shrink-0">Collection</span>
            <span className="font-mono truncate">{item.collection.address}</span>
          </div>
          {item.tokenURI && (
            <div className="flex gap-2 items-center min-w-0">
              <span className="text-muted-foreground flex-shrink-0">Token URI</span>
              {/^https?:\/\//.test(item.tokenURI) ? (
                <a
                  href={item.tokenURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-strato-blue hover:underline truncate inline-flex items-center gap-1"
                >
                  <span className="truncate">{item.tokenURI}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              ) : (
                <span className="font-mono truncate">{item.tokenURI}</span>
              )}
            </div>
          )}
        </div>

        {isOwner && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => setTransferOpen(true)}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Transfer
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBurnOpen(true)}>
              <Flame className="h-3.5 w-3.5 mr-1.5" />
              Burn
            </Button>
          </div>
        )}
      </div>

      <TransferNFTModal
        item={item}
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onTransferred={onChanged}
      />

      <AlertDialog open={burnOpen} onOpenChange={setBurnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Burn {item.collection.symbol} #{item.tokenId}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Burning permanently destroys this NFT. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={burning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBurn} disabled={burning}>
              {burning ? "Burning…" : "Burn"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GenericNFTDetail;
