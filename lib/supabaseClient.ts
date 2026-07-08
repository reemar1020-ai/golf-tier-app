import { createClient } from "@supabase/supabase-js";

let cachedClient: ReturnType<typeof createClient> | null = null;
let cachedConfig: { url: string; key: string } | null = null;

export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

  if (typeof window !== "undefined") {
    console.info("Supabase client init", {
      hasUrl: Boolean(supabaseUrl),
      hasKey: Boolean(supabaseKey),
      hasSupabaseConfig,
      url: supabaseUrl ? `${supabaseUrl.slice(0, 20)}...` : "",
    });
  }

  if (!hasSupabaseConfig) {
    cachedClient = null;
    cachedConfig = null;
    return null;
  }

  const nextConfig = { url: supabaseUrl, key: supabaseKey };
  if (cachedClient && cachedConfig && cachedConfig.url === nextConfig.url && cachedConfig.key === nextConfig.key) {
    return cachedClient;
  }

  cachedClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  cachedConfig = nextConfig;
  return cachedClient;
}

export const supabase = getSupabaseClient();
