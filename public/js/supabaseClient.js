import { ENV } from "../env.js";

export const supabase = window.supabase.createClient(
  ENV.SUPABASE_URL,
  ENV.SUPABASE_ANON_KEY
);

export async function whoami() {
  const { data, error } = await supabase.rpc("rpc_whoami");
  if (error) return null;
  return Array.isArray(data) && data.length ? data[0] : data;
}


