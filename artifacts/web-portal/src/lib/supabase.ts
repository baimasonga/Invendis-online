import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set");
}

export const supabase = createClient(url, key, {
  auth: {
    // Bypass the Web Locks API — without this, multiple browser contexts
    // sharing the same origin (e.g. the Replit canvas iframe + a direct tab)
    // deadlock each other waiting for the same named lock, causing
    // signInWithPassword to hang indefinitely.
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
  },
});
