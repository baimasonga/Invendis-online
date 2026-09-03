import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Farmers from "@/pages/farmers";
import FarmerDetail from "@/pages/farmer-detail";
import Inventory from "@/pages/inventory";
import Procurement from "@/pages/procurement";
import Campaigns from "@/pages/campaigns";
import CampaignDetail from "@/pages/campaign-detail";
import Allocations from "@/pages/allocations";
import Vehicles from "@/pages/vehicles";
import Dispatch from "@/pages/dispatch";
import DispatchDetail from "@/pages/dispatch-detail";
import GpsTracking from "@/pages/gps-tracking";
import Pod from "@/pages/pod";
import Reconciliation from "@/pages/reconciliation";
import Reports from "@/pages/reports";
import AuditLogs from "@/pages/audit";
import Users from "@/pages/users";
import Settings from "@/pages/settings";
import Incidents from "@/pages/incidents";
import FarmerCardPublic from "@/pages/farmer-card-public";
import SupervisorView from "@/pages/supervisor";

const queryClient = new QueryClient();

const normaliseRole = (role?: string | null) =>
  (role ?? "").toLowerCase().replace(/[\s_-]/g, "");

const ProtectedRoute = ({ component: Component, allowedRoles = [], ...rest }: any) => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  return (
    <Route
      {...rest}
      component={(props: any) =>
        isAuthenticated && (allowedRoles.length === 0 || allowedRoles.includes(normaliseRole(user?.role))) ? (
          <Layout>
            <Component {...props} />
          </Layout>
        ) : isAuthenticated ? (
          <Redirect to="/dashboard" />
        ) : (
          <Redirect to="/login" />
        )
      }
    />
  );
};

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/card/:token" component={FarmerCardPublic} />

      <ProtectedRoute path="/dashboard"        component={Dashboard} />
      <ProtectedRoute path="/farmers"          component={Farmers} />
      <ProtectedRoute path="/farmers/:id"      component={FarmerDetail} />
      <ProtectedRoute path="/inventory"        component={Inventory} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/procurement"      component={Procurement} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/campaigns"        component={Campaigns} allowedRoles={["admin", "projectmanager", "districtcoordinator"]} />
      <ProtectedRoute path="/campaigns/:id"    component={CampaignDetail} allowedRoles={["admin", "projectmanager", "districtcoordinator"]} />
      <ProtectedRoute path="/allocations"      component={Allocations} allowedRoles={["admin", "projectmanager", "districtcoordinator"]} />
      <ProtectedRoute path="/vehicles"         component={Vehicles} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/dispatch"         component={Dispatch} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/dispatch/:id"     component={DispatchDetail} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/gps-tracking"     component={GpsTracking} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/pod"              component={Pod} />
      <ProtectedRoute path="/reconciliation"   component={Reconciliation} allowedRoles={["admin", "projectmanager", "warehousemanager"]} />
      <ProtectedRoute path="/reports"          component={Reports} allowedRoles={["admin", "projectmanager", "districtcoordinator", "warehousemanager"]} />
      <ProtectedRoute path="/audit"            component={AuditLogs} allowedRoles={["admin", "projectmanager"]} />
      <ProtectedRoute path="/users"            component={Users} allowedRoles={["admin"]} />
      <ProtectedRoute path="/settings"         component={Settings} allowedRoles={["admin", "projectmanager"]} />
      <ProtectedRoute path="/incidents"        component={Incidents} allowedRoles={["admin", "projectmanager", "districtcoordinator"]} />
      <ProtectedRoute path="/supervisor"       component={SupervisorView} allowedRoles={["admin", "projectmanager", "districtcoordinator"]} />

      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
