import { useAuth } from "@/hooks/use-auth";

// Normalise role strings: strip spaces, lowercase
// Handles "FieldOfficer", "field_officer", "fieldofficer", etc.
function normalise(role?: string | null): string {
  return (role ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

const in_ = (role: string, ...allowed: string[]) => allowed.includes(role);

export interface Permissions {
  // Farmers
  registerFarmer: boolean;
  editFarmer:     boolean;
  approveFarmer:  boolean;

  // Campaigns & allocations
  createCampaign:    boolean;
  editCampaign:      boolean;
  manageAllocations: boolean;

  // Fleet
  manageFleet: boolean;

  // Inventory / Supply chain
  manageInventory:  boolean;
  manageProcurement: boolean;

  // Distribution
  manageDispatch: boolean;
  submitPod:      boolean;

  // Administration
  manageUsers:    boolean;
  manageSettings: boolean;
  viewAuditLogs:  boolean;
  viewReports:    boolean;
}

export function usePermissions(): Permissions {
  const { user } = useAuth();
  const role = normalise(user?.role);

  const isAdmin   = role === "admin";
  const isPM      = in_(role, "projectmanager");
  const isDC      = in_(role, "districtcoordinator");
  const isWM      = in_(role, "warehousemanager");
  const isField   = in_(role, "fieldofficer");

  return {
    registerFarmer: isAdmin || isPM || isDC || isField,
    editFarmer:     isAdmin || isPM || isDC,
    approveFarmer:  isAdmin || isPM,

    createCampaign:    isAdmin || isPM,
    editCampaign:      isAdmin || isPM,
    manageAllocations: isAdmin || isPM || isDC,

    manageFleet:      isAdmin || isPM || isWM,
    manageInventory:  isAdmin || isPM || isWM,
    manageProcurement: isAdmin || isPM || isWM,

    manageDispatch: isAdmin || isPM || isWM,
    submitPod:      isAdmin || isPM || isDC || isField,

    manageUsers:    isAdmin,
    manageSettings: isAdmin || isPM,
    viewAuditLogs:  isAdmin || isPM,
    viewReports:    isAdmin || isPM || isDC || isWM,
  };
}
