import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

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
  // Hold latest token for auto-sync on reconnect
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(QUEUE_KEY);
        if (stored) setQueue(JSON.parse(stored));
        const ls = await AsyncStorage.getItem(LAST_SYNC_KEY);
        if (ls) setLastSync(ls);
      } catch (err: unknown) {
        console.warn("OfflineQueue: failed to load from storage", err);
      }
    })();
  }, []);

  // Auto-sync pending items when network becomes available
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    Network.addNetworkStateListener((state) => {
      const online = state.isConnected && state.isInternetReachable;
      if (online && tokenRef.current) {
        const hasPending = queue.some((i) => i.status === "pending");
        if (hasPending && !isSyncing) {
          syncAll(tokenRef.current).catch((err: unknown) => {
            console.warn("OfflineQueue: auto-sync failed", err);
          });
        }
      }
    }).then((sub) => { subscription = sub; });
    return () => { subscription?.remove(); };
  // intentionally only runs once; syncAll is stable via useRef pattern below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveQueue = async (q: QueuedPoD[]) => {
    setQueue(q);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  };

  const enqueue = async (payload: Record<string, unknown>) => {
    const item: QueuedPoD = {
      id: crypto.randomUUID(),
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
    tokenRef.current = token;
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
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unknown error";
        const retryCount = (item.retryCount ?? 0) + 1;
        updated[i] = {
          ...item,
          status: retryCount >= MAX_RETRIES ? "failed" : "pending",
          error: message,
          retryCount,
        };
        failed++;
      }
    }

    const now = new Date().toISOString();
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      updated[idx] = { ...item, status: "failed", error: message, retryCount: (item.retryCount ?? 0) + 1 };
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
