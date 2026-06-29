import { Outlet } from "react-router-dom";
import { SidebarNav } from "@/components/layout/Sidebar";
import { Header, BrandMark } from "@/components/layout/Header";

export function DashboardLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <BrandMark />
        </div>
        <SidebarNav />
      </aside>

      <div className="md:pl-60">
        <Header />
        <main className="container mx-auto px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
