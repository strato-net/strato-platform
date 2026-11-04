import { Badge } from "@/components/ui/badge";

// Derived on-chain status: 0 Missing, 1 Registered (listed, not in the set), 2 Active, 3 Kicked.
export type ValidatorLifecycle = {
  status: 0 | 1 | 2 | 3;
  isWaiter?: boolean;
  // After a liveness removal: the time the validator may be seated again.
  jailedUntil?: string;
  // An announced handover the incoming operator has yet to complete.
  pendingOperator?: string;
};

const describeValidatorStatus = (v: ValidatorLifecycle): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } => {
  const now = Date.now() / 1000;
  if (v.status === 3) return { label: "Removed", variant: "destructive" };
  if (Number(v.jailedUntil || "0") > now) return { label: "Removed for misses", variant: "destructive" };
  if (v.pendingOperator) return { label: v.status === 2 ? "Active · handover pending" : "Handover pending", variant: "outline" };
  if (v.status === 2) return { label: "Active", variant: "secondary" };
  if (v.isWaiter) return { label: "Ready to join", variant: "outline" };
  if (v.status === 1) return { label: "Registered", variant: "outline" };
  return { label: "Unlisted", variant: "outline" };
};

const ValidatorStatusBadge = ({ validator }: { validator: ValidatorLifecycle }) => {
  const { label, variant } = describeValidatorStatus(validator);
  return <Badge variant={variant}>{label}</Badge>;
};

export default ValidatorStatusBadge;
