import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export interface QueuedPoD {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "failed";
  error?: string;
}

interface OfflineQueueContextType {
  queue: QueuedPoD[];
  enqueue: (payload: Record<string, unknown>) => Promise<void>;
  syncAll: (token: string) => Promise<{ success: number; failed: number }>;
  clearSynced: () => Promise<void>;
  isSyncing: boolean;
  lastSync: string | null;
}

const OfflineQueueContext = createContext<OfflineQueueContextType | null>(null);
const QUEUE_KEY = "@pod_queue";
const LAST_SYNC_KEY = "@last_sync";

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedPoD[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(QUEUE_KEY);
        if (stored) setQueue(JSON.parse(stored));
        const ls = await AsyncStorage.getItem(LAST_SYNC_KEY);
        if (ls) setLastSync(ls);
      } catch {}
    })();
  }, []);

  const saveQueue = async (q: QueuedPoD[]) => {
    setQueue(q);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  };

  const enqueue = async (payload: Record<string, unknown>) => {
    const item: QueuedPoD = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
      payload,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    const updated = [...queue, item];
    await saveQueue(updated);
  };

  const syncAll = async (token: string) => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    setIsSyncing(true);
    let success = 0;
    let failed = 0;
    const updated = [...queue];

    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      if (item.status !== "pending") continue;
      try {
        const res = await fetch(`https://${domain}/api/pod/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(item.payload),
        });
        if (res.ok) {
          updated[i] = { ...item, status: "failed", error: "synced" };
          success++;
        } else {
          const err = await res.json().catch(() => ({}));
          updated[i] = { ...item, status: "failed", error: (err as { error?: string }).error ?? "Server error" };
          failed++;
        }
      } catch (e) {
        updated[i] = { ...item, status: "failed", error: "Network error" };
        failed++;
      }
    }

    const now = new Date().toISOString();
    await saveQueue(updated.filter((i) => i.error !== "synced"));
    setLastSync(now);
    await AsyncStorage.setItem(LAST_SYNC_KEY, now);
    setIsSyncing(false);
    return { success, failed };
  };

  const clearSynced = async () => {
    const remaining = queue.filter((i) => i.status === "pending");
    await saveQueue(remaining);
  };

  return (
    <OfflineQueueContext.Provider value={{ queue, enqueue, syncAll, clearSynced, isSyncing, lastSync }}>
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue() {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error("useOfflineQueue must be used within OfflineQueueProvider");
  return ctx;
}
