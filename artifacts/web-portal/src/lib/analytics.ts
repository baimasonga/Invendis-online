type AnalyticsValue = string | number | boolean;
type AnalyticsProperties = Record<string, AnalyticsValue>;

declare global {
  interface Window {
    umami?: {
      track?: (event: string, properties?: AnalyticsProperties) => void;
    };
  }
}

/** Sends a publish-time Replit Umami event without making analytics app-critical. */
export function trackEvent(event: string, properties?: AnalyticsProperties): void {
  try {
    globalThis.window?.umami?.track?.(event, properties);
  } catch {
    // Analytics must never affect a portal action.
  }
}

export function countBucket(count: number): "0" | "1" | "2_5" | "6_20" | "21_plus" {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 20) return "6_20";
  return "21_plus";
}