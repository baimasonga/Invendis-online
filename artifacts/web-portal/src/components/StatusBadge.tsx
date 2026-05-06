import { CheckCircle2, Clock, XCircle, Truck, Package, AlertCircle, HelpCircle, Circle } from "lucide-react";

type StatusVariant =
  | "approved" | "pending" | "rejected"
  | "dispatched" | "intransit" | "arrived" | "completed" | "cancelled"
  | "verified" | "exception"
  | "active" | "inactive";

const STATUS_CONFIG: Record<string, { cls: string; icon: React.ElementType }> = {
  approved:   { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  verified:   { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  completed:  { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  active:     { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  pending:    { cls: "bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-400",   icon: Clock },
  approved_d: { cls: "bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-400",   icon: Clock },
  dispatched: { cls: "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400",    icon: Truck },
  intransit:  { cls: "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400",    icon: Truck },
  arrived:    { cls: "bg-teal-100   text-teal-800   dark:bg-teal-900/30   dark:text-teal-400",    icon: Package },
  rejected:   { cls: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400",     icon: XCircle },
  cancelled:  { cls: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400",     icon: XCircle },
  exception:  { cls: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400",     icon: AlertCircle },
  inactive:   { cls: "bg-slate-100  text-slate-600  dark:bg-slate-800     dark:text-slate-400",   icon: Circle },
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "default";
}

export function StatusBadge({ status, size = "default" }: StatusBadgeProps) {
  const key = status?.toLowerCase().replace(/[\s-]/g, "");
  const { cls, icon: Icon } = STATUS_CONFIG[key] ?? {
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    icon: HelpCircle,
  };
  const iconSize = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium capitalize ${cls} ${textSize}`}>
      <Icon className={`${iconSize} shrink-0`} />
      {status}
    </span>
  );
}
