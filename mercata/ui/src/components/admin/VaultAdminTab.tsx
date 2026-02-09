import { useState, useEffect } from "react";
import { Loader2, Pause, Play, Plus, Trash2, Save, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { useVaultContext, VaultAsset } from "@/context/VaultContext";
import { useToast } from "@/hooks/use-toast";
import { formatUnits, parseUnits } from "ethers";

const formatTokenAmount = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value, 18));
    if (num === 0) return "0";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 4,
    });
  } catch {
    return "0";
  }
};

interface ReserveEdit {
  address: string;
  symbol: string;
  currentMinReserve: string;
  newMinReserve: string;
  isEditing: boolean;
  isSaving: boolean;
}

const VaultAdminTab = () => {
  const [pauseLoading, setPauseLoading] = useState(false);
  const [confirmPauseOpen, setConfirmPauseOpen] = useState(false);
  const [newAssetAddress, setNewAssetAddress] = useState("");
  const [addAssetLoading, setAddAssetLoading] = useState(false);
  const [addAssetModalOpen, setAddAssetModalOpen] = useState(false);
  const [removeAssetAddress, setRemoveAssetAddress] = useState<string | null>(null);
  const [removeAssetLoading, setRemoveAssetLoading] = useState(false);
  const [newBotExecutor, setNewBotExecutor] = useState("");
  const [botExecutorLoading, setBotExecutorLoading] = useState(false);
  const [reserveEdits, setReserveEdits] = useState<Record<string, ReserveEdit>>({});

  const {
    vaultState,
    refreshVault,
    adminPause,
    adminUnpause,
    adminSetMinReserve,
    adminSetBotExecutor,
    adminAddAsset,
    adminRemoveAsset,
  } = useVaultContext();

  const { toast } = useToast();

  const { paused, assets, botExecutor, loading } = vaultState;

  // Initialize reserve edits when assets change
  useEffect(() => {
    const edits: Record<string, ReserveEdit> = {};
    assets.forEach((asset) => {
      edits[asset.address] = {
        address: asset.address,
        symbol: asset.symbol,
        currentMinReserve: asset.minReserve,
        newMinReserve: formatUnits(asset.minReserve, 18),
        isEditing: false,
        isSaving: false,
      };
    });
    setReserveEdits(edits);
  }, [assets]);

  const handleTogglePause = async () => {
    setPauseLoading(true);
    try {
      if (paused) {
        await adminUnpause();
        toast({
          title: "Vault Unpaused",
          description: "The vault is now accepting deposits and withdrawals.",
          variant: "success",
        });
      } else {
        await adminPause();
        toast({
          title: "Vault Paused",
          description: "The vault is now paused. Deposits and withdrawals are disabled.",
          variant: "success",
        });
      }
      // Stop spinner and close dialog first, then refresh in background
      setPauseLoading(false);
      setConfirmPauseOpen(false);
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to toggle pause state",
        variant: "destructive",
      });
      setPauseLoading(false);
      setConfirmPauseOpen(false);
    }
  };

  const handleAddAsset = async () => {
    if (!newAssetAddress) return;

    setAddAssetLoading(true);
    try {
      await adminAddAsset({ token: newAssetAddress });
      toast({
        title: "Asset Added",
        description: `Successfully added asset to vault.`,
        variant: "success",
      });
      setAddAssetLoading(false);
      setNewAssetAddress("");
      setAddAssetModalOpen(false);
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to add asset",
        variant: "destructive",
      });
      setAddAssetLoading(false);
    }
  };

  const handleRemoveAsset = async () => {
    if (!removeAssetAddress) return;

    setRemoveAssetLoading(true);
    try {
      await adminRemoveAsset({ token: removeAssetAddress });
      toast({
        title: "Asset Removed",
        description: "Successfully removed asset from vault.",
        variant: "success",
      });
      setRemoveAssetLoading(false);
      setRemoveAssetAddress(null);
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to remove asset",
        variant: "destructive",
      });
      setRemoveAssetLoading(false);
      setRemoveAssetAddress(null);
    }
  };

  const handleSaveReserve = async (address: string) => {
    const edit = reserveEdits[address];
    if (!edit) return;

    setReserveEdits((prev) => ({
      ...prev,
      [address]: { ...prev[address], isSaving: true },
    }));

    try {
      const minReserveWei = parseUnits(edit.newMinReserve, 18).toString();
      await adminSetMinReserve({ token: address, minReserve: minReserveWei });
      toast({
        title: "Reserve Updated",
        description: `Min reserve for ${edit.symbol} updated to ${edit.newMinReserve}`,
        variant: "success",
      });
      setReserveEdits((prev) => ({
        ...prev,
        [address]: { ...prev[address], isSaving: false, isEditing: false },
      }));
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to update reserve",
        variant: "destructive",
      });
      setReserveEdits((prev) => ({
        ...prev,
        [address]: { ...prev[address], isSaving: false, isEditing: false },
      }));
    }
  };

  const handleUpdateBotExecutor = async () => {
    if (!newBotExecutor) return;

    setBotExecutorLoading(true);
    try {
      await adminSetBotExecutor({ executor: newBotExecutor });
      toast({
        title: "Bot Executor Updated",
        description: "Successfully updated bot executor address.",
        variant: "success",
      });
      setBotExecutorLoading(false);
      setNewBotExecutor("");
      refreshVault(false);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to update bot executor",
        variant: "destructive",
      });
      setBotExecutorLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            System Status
            <Badge variant={paused ? "destructive" : "default"}>
              {paused ? "Paused" : "Active"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Control the operational state of the vault
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {paused
                  ? "The vault is currently paused. Deposits and withdrawals are disabled."
                  : "The vault is active and accepting deposits/withdrawals."}
              </p>
            </div>
            <Button
              variant={paused ? "default" : "destructive"}
              onClick={() => setConfirmPauseOpen(true)}
              disabled={pauseLoading}
            >
              {pauseLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : paused ? (
                <Play className="h-4 w-4 mr-2" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              {paused ? "Unpause Vault" : "Pause Vault"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Supported Assets */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Supported Assets</CardTitle>
              <CardDescription>
                Manage which tokens can be deposited into the vault
              </CardDescription>
            </div>
            <Button onClick={() => setAddAssetModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Asset
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No assets configured. Add an asset to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Address</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.address}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {asset.images?.[0]?.value ? (
                          <img
                            src={asset.images[0].value}
                            alt={asset.symbol}
                            className="w-6 h-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs text-white font-medium">
                            {asset.symbol?.slice(0, 2)}
                          </div>
                        )}
                        <span className="font-medium">{asset.symbol}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {asset.address.slice(0, 8)}...{asset.address.slice(-6)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatTokenAmount(asset.balance)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setRemoveAssetAddress(asset.address)}
                        disabled={BigInt(asset.balance || "0") > BigInt(0)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reserve Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Reserve Configuration</CardTitle>
          <CardDescription>
            Set minimum reserve amounts for each asset
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No assets to configure.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Current Balance</TableHead>
                  <TableHead className="text-right">Min Reserve</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => {
                  const edit = reserveEdits[asset.address];
                  return (
                    <TableRow key={asset.address}>
                      <TableCell>
                        <span className="font-medium">{asset.symbol}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatTokenAmount(asset.balance)}
                      </TableCell>
                      <TableCell className="text-right">
                        {edit?.isEditing ? (
                          <Input
                            value={edit.newMinReserve}
                            onChange={(e) =>
                              setReserveEdits((prev) => ({
                                ...prev,
                                [asset.address]: {
                                  ...prev[asset.address],
                                  newMinReserve: e.target.value,
                                },
                              }))
                            }
                            className="w-32 text-right"
                          />
                        ) : (
                          <span className="font-mono">
                            {formatTokenAmount(asset.minReserve)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {edit?.isEditing ? (
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleSaveReserve(asset.address)}
                              disabled={edit.isSaving}
                            >
                              {edit.isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setReserveEdits((prev) => ({
                                  ...prev,
                                  [asset.address]: {
                                    ...prev[asset.address],
                                    isEditing: false,
                                    newMinReserve: formatUnits(asset.minReserve, 18),
                                  },
                                }))
                              }
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setReserveEdits((prev) => ({
                                ...prev,
                                [asset.address]: {
                                  ...prev[asset.address],
                                  isEditing: true,
                                },
                              }))
                            }
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bot Executor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Bot Executor
          </CardTitle>
          <CardDescription>
            Configure the address authorized to execute bot operations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Current Bot Executor</label>
            <p className="font-mono text-sm text-muted-foreground mt-1">
              {botExecutor || "Not configured"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Enter new bot executor address"
              value={newBotExecutor}
              onChange={(e) => setNewBotExecutor(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={handleUpdateBotExecutor}
              disabled={!newBotExecutor || botExecutorLoading}
            >
              {botExecutorLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Update"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirm Pause Dialog */}
      <AlertDialog open={confirmPauseOpen} onOpenChange={setConfirmPauseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paused ? "Unpause Vault?" : "Pause Vault?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paused
                ? "This will allow deposits and withdrawals to resume."
                : "This will prevent any deposits or withdrawals until the vault is unpaused."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTogglePause}>
              {paused ? "Unpause" : "Pause"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Asset Modal */}
      <Dialog open={addAssetModalOpen} onOpenChange={setAddAssetModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Supported Asset</DialogTitle>
            <DialogDescription>
              Enter the token address to add as a supported vault asset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Token address"
              value={newAssetAddress}
              onChange={(e) => setNewAssetAddress(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddAssetModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddAsset}
              disabled={!newAssetAddress || addAssetLoading}
            >
              {addAssetLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Add Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Asset Confirmation */}
      <AlertDialog
        open={!!removeAssetAddress}
        onOpenChange={() => setRemoveAssetAddress(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Asset?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the asset from the vault's supported assets list.
              Make sure the vault has no balance of this token before removing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveAsset}
              className="bg-red-600 hover:bg-red-700"
            >
              {removeAssetLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default VaultAdminTab;
