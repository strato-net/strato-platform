import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { USER_REGISTRY_ADDRESS } from "@/services/userWallets";

/** Create a new User wallet by calling createUser(string) on the UserRegistry (0x720). */
export function CreateUserDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const { submit, canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();

  const create = async () => {
    const name = username.trim();
    if (!name) {
      toast.error("Enter a username");
      return;
    }
    setPending(true);
    try {
      // createUser uses msg.sender as the new wallet's owner, so this is a plain
      // function call signed by the connected account — no wallet wrapping needed.
      await submit("FUNCTION", {
        contractName: "UserRegistry",
        contractAddress: USER_REGISTRY_ADDRESS,
        value: 0,
        method: "createUser",
        args: { _username: name },
        metadata: {},
      });
      toast.success(`Created User wallet "${name}"`);
      setUsername("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["my-user-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : String(err?.message || err);
      toast.error("Create user failed", { description: msg });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Create User
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User wallet</DialogTitle>
          <DialogDescription>
            Calls createUser on the UserRegistry. The new wallet is owned by your connected
            account and gets a deterministic address derived from the username.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="new-username">Username</Label>
          <Input
            id="new-username"
            placeholder="e.g. alice"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            autoFocus
          />
          {!canSubmit ? (
            <p className="text-xs text-muted-foreground">Connect a wallet to create a user.</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={pending || !canSubmit}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
