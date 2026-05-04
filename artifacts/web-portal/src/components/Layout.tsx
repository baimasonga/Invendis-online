import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, Users, Box, ShoppingCart, Flag, 
  MapPin, Truck, Map, CheckSquare, RefreshCcw, 
  BarChart3, ShieldAlert, Settings, LogOut, Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/farmers", label: "Farmers", icon: Users },
    { href: "/inventory", label: "Inventory", icon: Box },
    { href: "/procurement", label: "Procurement", icon: ShoppingCart },
    { href: "/campaigns", label: "Campaigns", icon: Flag },
    { href: "/allocations", label: "Allocations", icon: MapPin },
    { href: "/vehicles", label: "Vehicles", icon: Truck },
    { href: "/dispatch", label: "Dispatch", icon: Truck },
    { href: "/gps-tracking", label: "GPS Tracking", icon: Map },
    { href: "/pod", label: "Proof of Delivery", icon: CheckSquare },
    { href: "/reconciliation", label: "Reconciliation", icon: RefreshCcw },
    { href: "/reports", label: "Reports", icon: BarChart3 },
    { href: "/audit", label: "Audit Logs", icon: ShieldAlert },
    { href: "/users", label: "Users", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border hidden md:flex flex-col text-sidebar-foreground">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-sidebar-primary-foreground">Agri-PoD</h1>
          <p className="text-xs text-sidebar-foreground/70 mt-1">Field Operations System</p>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>
                  <div className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    location.startsWith(item.href) 
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" 
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}>
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm">{item.label}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold">
              {user?.fullName?.charAt(0) || "U"}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate">{user?.fullName}</p>
              <p className="text-xs text-sidebar-foreground/70 truncate">{user?.role}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={logout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar for mobile */}
        <header className="h-14 border-b bg-card flex items-center justify-between px-4 md:hidden">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-bold">Agri-PoD</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            Logout
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
