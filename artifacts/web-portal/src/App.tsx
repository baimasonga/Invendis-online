import { lazy, Suspense, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";

const NotFound = lazy(() => import("@/pages/not-found"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Farmers = lazy(() => import("@/pages/farmers"));
const FarmerDetail = lazy(() => import("@/pages/farmer-detail"));
const Inventory = lazy(() => import("@/pages/inventory"));
const Procurement = lazy(() => import("@/pages/procurement"));
const Campaigns = lazy(() => import("@/pages/campaigns"));
const CampaignDetail = lazy(() => import("@/pages/campaign-detail"));
const Allocations = lazy(() => import("@/pages/allocations"));
const Vehicles = lazy(() => import("@/pages/vehicles"));
const Dispatch = lazy(() => import("@/pages/dispatch"));
const DispatchDetail = lazy(() => import("@/pages/dispatch-detail"));
const GpsTracking = lazy(() => import("@/pages/gps-tracking"));
const RoadMapping = lazy(() => import("@/pages/road-mapping"));
const Pod = lazy(() => import("@/pages/pod"));
const Reconciliation = lazy(() => import("@/pages/reconciliation"));
const Reports = lazy(() => import("@/pages/reports"));
const AuditLogs = lazy(() => import("@/pages/audit"));
const Users = lazy(() => import("@/pages/users"));
const Settings = lazy(() => import("@/pages/settings"));
const Incidents = lazy(() => import("@/pages/incidents"));
const FarmerCardPublic = lazy(() => import("@/pages/farmer-card-public"));
const SupervisorView = lazy(() => import("@/pages/supervisor"));

const queryClient = new QueryClient();
const MANAGEMENT = ["admin", "projectmanager", "districtcoordinator", "warehousemanager", "viewer"];
const FIELD_OPERATIONS = ["admin", "projectmanager", "districtcoordinator"];
const SUPPLY_CHAIN = ["admin", "projectmanager", "warehousemanager"];

function normaliseRole(role?: string | null): string {
  return (role ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

function PageLoading() {
  return <div className="flex h-screen items-center justify-center">Loading...</div>;
}

function AccessDenied() {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-lg border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your account does not have permission to view this page.</p>
    </div>
  );
}

type ProtectedRouteProps = {
  component: ComponentType<any>;
  path: string;
  roles?: readonly string[];
};

function ProtectedRoute({ component: Component, roles = MANAGEMENT, ...rest }: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoading />;

  return (
    <Route
      {...rest}
      component={(props: any) => {
        if (!isAuthenticated) return <Redirect to="/login" />;
        const allowed = roles.includes(normaliseRole(user?.role));
        return (
          <Layout>
            <Suspense fallback={<PageLoading />}>
              {allowed ? <Component {...props} /> : <AccessDenied />}
            </Suspense>
          </Layout>
        );
      }}
    />
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/card/:token" component={FarmerCardPublic} />

        <ProtectedRoute path="/dashboard" component={Dashboard} />
        <ProtectedRoute path="/farmers" component={Farmers} />
        <ProtectedRoute path="/farmers/:id" component={FarmerDetail} />
        <ProtectedRoute path="/inventory" component={Inventory} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/procurement" component={Procurement} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/campaigns" component={Campaigns} roles={FIELD_OPERATIONS} />
        <ProtectedRoute path="/campaigns/:id" component={CampaignDetail} roles={FIELD_OPERATIONS} />
        <ProtectedRoute path="/allocations" component={Allocations} roles={FIELD_OPERATIONS} />
        <ProtectedRoute path="/vehicles" component={Vehicles} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/dispatch" component={Dispatch} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/dispatch/:id" component={DispatchDetail} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/gps-tracking" component={GpsTracking} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/road-mapping" component={RoadMapping} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/pod" component={Pod} />
        <ProtectedRoute path="/reconciliation" component={Reconciliation} roles={SUPPLY_CHAIN} />
        <ProtectedRoute path="/reports" component={Reports} roles={[...FIELD_OPERATIONS, "warehousemanager"]} />
        <ProtectedRoute path="/audit" component={AuditLogs} roles={["admin", "projectmanager"]} />
        <ProtectedRoute path="/users" component={Users} roles={["admin"]} />
        <ProtectedRoute path="/settings" component={Settings} roles={["admin", "projectmanager"]} />
        <ProtectedRoute path="/incidents" component={Incidents} roles={FIELD_OPERATIONS} />
        <ProtectedRoute path="/supervisor" component={SupervisorView} roles={FIELD_OPERATIONS} />

        <Route path="/"><Redirect to="/dashboard" /></Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider><Router /></AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
