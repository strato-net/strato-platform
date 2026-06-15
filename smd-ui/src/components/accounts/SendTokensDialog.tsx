import { useState } from "react";
import { useForm } from "react-hook-form";
import { parseEther, isAddress } from "viem";
import { useSendTransaction } from "wagmi";
import { toast } from "sonner";
import { Send } from "lucide-react";
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

interface SendForm {
  toAddress: string;
  amount: string;
}

export function SendTokensDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { sendTransactionAsync, isPending } = useSendTransaction();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<SendForm>({ defaultValues: { toAddress: "", amount: "" } });

  const onSubmit = async (values: SendForm) => {
    if (!isAddress(values.toAddress)) {
      setError("toAddress", { message: "Enter a valid 0x address" });
      return;
    }
    let value: bigint;
    try {
      value = parseEther(values.amount);
      if (value <= 0n) throw new Error();
    } catch {
      setError("amount", { message: "Enter a positive amount" });
      return;
    }

    try {
      const hash = await sendTransactionAsync({ to: values.toAddress as `0x${string}`, value });
      toast.success("Transaction submitted", { description: hash });
      reset();
      setOpen(false);
    } catch (err: any) {
      toast.error("Transaction failed", {
        description: err?.shortMessage || err?.message || "Could not send tokens",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled} className="gap-2">
          <Send className="h-4 w-4" />
          Send tokens
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Send tokens</DialogTitle>
            <DialogDescription>
              Transfer native STRATO tokens from your connected wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="toAddress">Recipient address</Label>
              <Input id="toAddress" placeholder="0x…" {...register("toAddress", { required: "Required" })} />
              {errors.toAddress ? (
                <p className="text-xs text-destructive">{errors.toAddress.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" placeholder="0.0" inputMode="decimal" {...register("amount", { required: "Required" })} />
              {errors.amount ? (
                <p className="text-xs text-destructive">{errors.amount.message}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
