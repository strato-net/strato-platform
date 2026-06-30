import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  to?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-primary",
  success: "text-green-500",
  warning: "text-amber-500",
  danger: "text-destructive",
};

export function StatCard({ label, value, icon: Icon, to, tone = "default" }: StatCardProps) {
  const body = (
    <Card className={cn("transition-colors", to && "hover:border-primary/50")}>
      <CardContent className="flex items-center gap-4 p-5">
        {Icon ? (
          <div className={cn("rounded-lg bg-muted p-3", toneClasses[tone])}>
            <Icon className="h-6 w-6" />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
