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
import GpsTracking from "@/pages/gps-tracking";
import Pod from "@/pages/pod";
import Reconciliation from "@/pages/reconciliation";
import Reports from "@/pages/reports";
import AuditLogs from "@/pages/audit";
import Users from "@/pages/users";
import Settings from "@/pages/settings";

const queryClient = new QueryClient();

// Protected Route Wrapper
const ProtectedRoute = ({ component: Component, ...rest }: any) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  return (
    <Route
      {...rest}
      component={(props: any) =>
        isAuthenticated ? (
          <Layout>
            <Component {...props} />
          </Layout>
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
      
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/farmers" component={Farmers} />
      <ProtectedRoute path="/farmers/:id" component={FarmerDetail} />
      <ProtectedRoute path="/inventory" component={Inventory} />
      <ProtectedRoute path="/procurement" component={Procurement} />
      <ProtectedRoute path="/campaigns" component={Campaigns} />
      <ProtectedRoute path="/campaigns/:id" component={CampaignDetail} />
      <ProtectedRoute path="/allocations" component={Allocations} />
      <ProtectedRoute path="/vehicles" component={Vehicles} />
      <ProtectedRoute path="/dispatch" component={Dispatch} />
      <ProtectedRoute path="/gps-tracking" component={GpsTracking} />
      <ProtectedRoute path="/pod" component={Pod} />
      <ProtectedRoute path="/reconciliation" component={Reconciliation} />
      <ProtectedRoute path="/reports" component={Reports} />
      <ProtectedRoute path="/audit" component={AuditLogs} />
      <ProtectedRoute path="/users" component={Users} />
      <ProtectedRoute path="/settings" component={Settings} />
      
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
