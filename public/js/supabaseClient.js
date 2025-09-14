// public/js/supabaseClient.js
if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
  console.error("[ENV] Faltan SUPABASE_URL o SUPABASE_ANON_KEY en env.js");
}

export const supabase = window.supabase.createClient(
  window.ENV.SUPABASE_URL,
  window.ENV.SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
