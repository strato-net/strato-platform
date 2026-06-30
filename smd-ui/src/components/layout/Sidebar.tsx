import { NavLink } from "react-router-dom";
import { Users, FileCode2, LayoutDashboard, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { to: "/accounts", label: "Accounts", icon: Users, enabled: true },
  { to: "/contracts", label: "Contracts", icon: FileCode2, enabled: true },
  { to: "/explorer", label: "Explorer", icon: Boxes, enabled: true },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map(({ to, label, icon: Icon, enabled }) =>
        enabled ? (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ) : (
          <div
            key={to}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/40 cursor-not-allowed"
            title="Coming soon"
          >
            <Icon className="h-4 w-4" />
            {label}
            <span className="ml-auto text-[10px] uppercase tracking-wide">soon</span>
          </div>
        )
      )}
    </nav>
  );
}
