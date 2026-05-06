import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export interface QueuedPoD {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "failed" | "synced";
  error?: string;
  retryCount?: number;
}

interface OfflineQueueContextType {
  queue: QueuedPoD[];
  enqueue: (payload: Record<string, unknown>) => Promise<void>;
  syncAll: (token: string) => Promise<{ success: number; failed: number }>;
  retryItem: (id: string, token: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  clearFailed: () => Promise<void>;
  isSyncing: boolean;
  lastSync: string | null;
}

const OfflineQueueContext = createContext<OfflineQueueContextType | null>(null);
const QUEUE_KEY = "@pod_queue";
const LAST_SYNC_KEY = "@last_sync";
const MAX_RETRIES = 3;

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
      retryCount: 0,
    };
    await saveQueue([...queue, item]);
  };

  async function submitPod(domain: string, token: string, payload: Record<string, unknown>) {
    const res = await fetch(`https://${domain}/api/pod/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `Server error ${res.status}`);
    }
  }

  const syncAll = async (token: string) => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    setIsSyncing(true);
    let success = 0;
    let failed = 0;
    const updated = [...queue];

    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      if (item.status === "synced") continue;
      try {
        await submitPod(domain!, token, item.payload);
        updated[i] = { ...item, status: "synced" };
        success++;
      } catch (e: any) {
        const retryCount = (item.retryCount ?? 0) + 1;
        updated[i] = {
          ...item,
          status: retryCount >= MAX_RETRIES ? "failed" : "pending",
          error: e.message ?? "Unknown error",
          retryCount,
        };
        failed++;
      }
    }

    const now = new Date().toISOString();
    // Keep failed items, remove synced
    await saveQueue(updated.filter((i) => i.status !== "synced"));
    setLastSync(now);
    await AsyncStorage.setItem(LAST_SYNC_KEY, now);
    setIsSyncing(false);
    return { success, failed };
  };

  const retryItem = async (id: string, token: string) => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    const idx = queue.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const item = queue[idx];
    const updated = [...queue];
    try {
      await submitPod(domain!, token, item.payload);
      updated.splice(idx, 1);
    } catch (e: any) {
      updated[idx] = { ...item, status: "failed", error: e.message, retryCount: (item.retryCount ?? 0) + 1 };
    }
    await saveQueue(updated);
  };

  const removeItem = async (id: string) => {
    await saveQueue(queue.filter((i) => i.id !== id));
  };

  const clearFailed = async () => {
    await saveQueue(queue.filter((i) => i.status !== "failed"));
  };

  return (
    <OfflineQueueContext.Provider value={{ queue, enqueue, syncAll, retryItem, removeItem, clearFailed, isSyncing, lastSync }}>
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue() {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error("useOfflineQueue must be used within OfflineQueueProvider");
  return ctx;
}
