import { Badge } from "@/components/ui/badge";

// Derived on-chain status: 0 Missing, 1 Registered (listed, not in the set), 2 Active, 3 Kicked.
export type ValidatorLifecycle = {
  status: 0 | 1 | 2 | 3;
  isWaiter?: boolean;
  jailedUntil?: string;
  exitReadyTime?: string;
};

const describeValidatorStatus = (v: ValidatorLifecycle): { label: string; variant: "default" | "secondary" | "outline" | "destructive" | "success" | "warning" } => {
  const now = Date.now() / 1000;
  if (v.status === 3) return { label: "Kicked", variant: "destructive" };
  if (Number(v.jailedUntil || "0") > now) return { label: "Jailed", variant: "destructive" };
  if (v.status === 2 && Number(v.exitReadyTime || "0") > 0) return { label: "Exiting", variant: "warning" };
  if (v.status === 2) return { label: "Active", variant: "success" };
  if (v.isWaiter) return { label: "Waiting", variant: "warning" };
  if (v.status === 1) return { label: "Registered", variant: "outline" };
  return { label: "Unlisted", variant: "outline" };
};

const ValidatorStatusBadge = ({ validator }: { validator: ValidatorLifecycle }) => {
  const { label, variant } = describeValidatorStatus(validator);
  return <Badge variant={variant}>{label}</Badge>;
};

export default ValidatorStatusBadge;
