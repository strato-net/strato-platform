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
  default: "bg-primary/10 text-primary dark:bg-primary/20 dark:text-[hsl(var(--chart-1))]",
  success: "bg-green-500/10 text-green-500",
  warning: "bg-amber-500/10 text-amber-500",
  danger: "bg-destructive/10 text-destructive",
};

export function StatCard({ label, value, icon: Icon, to, tone = "default" }: StatCardProps) {
  const body = (
    <Card className={cn("transition-colors", to && "hover:border-primary/50")}>
      <CardContent className="flex items-center gap-4 p-5">
        {Icon ? (
          <div className={cn("rounded-lg p-3", toneClasses[tone])}>
            <Icon className="h-6 w-6" />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
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
