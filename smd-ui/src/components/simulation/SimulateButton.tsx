import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SimulateButtonProps {
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  label?: string;
}

/** Footer-slot dry-run button; sits beside the real submit button. */
export function SimulateButton({ onClick, pending, disabled, label = "Simulate" }: SimulateButtonProps) {
  return (
    <Button variant="outline" onClick={onClick} disabled={pending || disabled} className="gap-1.5">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      {pending ? "Simulating…" : label}
    </Button>
  );
}
