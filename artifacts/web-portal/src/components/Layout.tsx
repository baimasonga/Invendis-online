import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Box, ShoppingCart, Flag,
  MapPin, Truck, Map, CheckSquare, RefreshCcw,
  BarChart3, ShieldAlert, Settings, LogOut, Package,
  Navigation, ClipboardList, Menu, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Field Operations",
    items: [
      { href: "/farmers", label: "Farmers", icon: Users },
      { href: "/campaigns", label: "Campaigns", icon: Flag },
      { href: "/allocations", label: "Allocations", icon: MapPin },
    ],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/inventory", label: "Inventory", icon: Box },
      { href: "/procurement", label: "Procurement", icon: ShoppingCart },
    ],
  },
  {
    label: "Distribution",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: Truck },
      { href: "/dispatch", label: "Dispatch", icon: Package },
      { href: "/gps-tracking", label: "GPS Tracking", icon: Navigation },
      { href: "/pod", label: "Proof of Delivery", icon: CheckSquare },
      { href: "/reconciliation", label: "Reconciliation", icon: RefreshCcw },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/audit", label: "Audit Logs", icon: ShieldAlert },
      { href: "/users", label: "Users", icon: ClipboardList },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function SidebarContent({ location, user, logout, onClose }: {
  location: string;
  user: { fullName?: string; role?: string } | null;
  logout: () => void;
  onClose?: () => void;
}) {
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
        {NAV_GROUPS.map((group) => (
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
            <p className="text-[10px] text-sidebar-foreground/60 truncate leading-tight">{user?.role}</p>
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

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
