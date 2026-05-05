import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Box, ShoppingCart, Flag,
  MapPin, Truck, Map, CheckSquare, RefreshCcw,
  BarChart3, ShieldAlert, Settings, LogOut, Package,
  Navigation, ClipboardList, Menu, X, Lock, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAlertCounts, KEYS } from "@/lib/db";

function normaliseRole(role?: string | null) {
  return (role ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: [] as string[] },
    ],
  },
  {
    label: "Field Operations",
    items: [
      { href: "/farmers",     label: "Farmers",     icon: Users,    roles: [] },
      { href: "/campaigns",   label: "Campaigns",   icon: Flag,     roles: ["admin","projectmanager","districtcoordinator"] },
      { href: "/allocations", label: "Allocations", icon: MapPin,   roles: ["admin","projectmanager","districtcoordinator"] },
    ],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/inventory",   label: "Inventory",   icon: Box,          roles: ["admin","projectmanager","warehousemanager"] },
      { href: "/procurement", label: "Procurement", icon: ShoppingCart, roles: ["admin","projectmanager","warehousemanager"] },
    ],
  },
  {
    label: "Distribution",
    items: [
      { href: "/vehicles",      label: "Vehicles",          icon: Truck,         roles: ["admin","projectmanager","warehousemanager"] },
      { href: "/dispatch",      label: "Dispatch",          icon: Package,       roles: ["admin","projectmanager","warehousemanager"] },
      { href: "/gps-tracking",  label: "GPS Tracking",      icon: Navigation,    roles: ["admin","projectmanager","warehousemanager"] },
      { href: "/pod",           label: "Proof of Delivery", icon: CheckSquare,   roles: [] },
      { href: "/reconciliation",label: "Reconciliation",    icon: RefreshCcw,    roles: ["admin","projectmanager","warehousemanager"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/reports", label: "Reports",    icon: BarChart3,     roles: ["admin","projectmanager","districtcoordinator","warehousemanager"] },
      { href: "/audit",   label: "Audit Logs", icon: ShieldAlert,   roles: ["admin","projectmanager"] },
      { href: "/users",   label: "Users",      icon: ClipboardList, roles: ["admin"] },
      { href: "/settings",label: "Settings",   icon: Settings,      roles: ["admin","projectmanager"] },
    ],
  },
];

function SidebarContent({ location, user, logout, onClose }: {
  location: string;
  user: { fullName?: string; role?: string } | null;
  logout: () => void;
  onClose?: () => void;
}) {
  const role = normaliseRole(user?.role);

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) =>
      item.roles.length === 0 || item.roles.includes(role)
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border shrink-0">
        <div>
          <h1 className="text-sm font-bold tracking-tight text-sidebar-primary-foreground leading-none">Invendis</h1>
          <p className="text-[10px] text-sidebar-foreground/60 mt-0.5 uppercase tracking-wide">Field Operations</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-sidebar-foreground/60 hover:text-sidebar-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1.5">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
              {group.label}
            </p>
            <ul>
              {group.items.map((item) => {
                const active = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={onClose}>
                      <div className={`flex items-center gap-2 px-2 py-[5px] rounded-md text-[13px] transition-colors cursor-pointer ${
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      }`}>
                        <item.icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-2 py-2 border-t border-sidebar-border shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
          <div className="h-6 w-6 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground text-[10px] font-bold shrink-0">
            {user?.fullName?.charAt(0) ?? "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium truncate leading-tight">{user?.fullName}</p>
            <p className="text-[10px] text-sidebar-foreground/60 truncate leading-tight capitalize">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReadOnlyBanner() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
      <Lock className="h-3 w-3 shrink-0" />
      <span>Your role has read-only access to this section.</span>
    </div>
  );
}

function AlertBanner() {
  const { data } = useQuery({
    queryKey: KEYS.alertCounts(),
    queryFn: getAlertCounts,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingFarmers = data?.pendingFarmers ?? 0;
  const pendingPod     = data?.pendingPod     ?? 0;
  if (!pendingFarmers && !pendingPod) return null;

  const parts: React.ReactNode[] = [];
  if (pendingFarmers > 0) {
    parts.push(
      <Link key="farmers" href="/farmers?status=pending">
        <span className="font-semibold underline underline-offset-2 cursor-pointer hover:text-amber-900">
          {pendingFarmers} farmer{pendingFarmers !== 1 ? "s" : ""} pending approval
        </span>
      </Link>
    );
  }
  if (pendingPod > 0) {
    parts.push(
      <Link key="pod" href="/pod?status=Pending">
        <span className="font-semibold underline underline-offset-2 cursor-pointer hover:text-amber-900">
          {pendingPod} PoD{pendingPod !== 1 ? "s" : ""} awaiting verification
        </span>
      </Link>
    );
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2 flex items-center gap-2 shrink-0">
      <Bell className="h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span className="flex items-center gap-1.5 flex-wrap">
        {parts.reduce<React.ReactNode[]>((acc, node, i) => {
          if (i > 0) acc.push(<span key={`sep-${i}`} className="text-amber-400">·</span>);
          acc.push(node);
          return acc;
        }, [])}
      </span>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Desktop sidebar */}
      <aside className="w-56 bg-sidebar border-r border-sidebar-border hidden md:flex flex-col text-sidebar-foreground shrink-0">
        <SidebarContent location={location} user={user} logout={logout} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-56 bg-sidebar text-sidebar-foreground flex flex-col md:hidden transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <SidebarContent location={location} user={user} logout={logout} onClose={() => setMobileOpen(false)} />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="h-12 border-b bg-card flex items-center justify-between px-4 md:hidden shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <span className="font-bold text-sm">Invendis</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="text-xs h-7">
            Sign out
          </Button>
        </header>

        {/* Alert banner — pending farmers + PoDs */}
        <AlertBanner />

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
