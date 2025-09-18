import { supabase } from "./supabaseClient.js";

/**
 * checkSession()
 * - Verifica si hay sesión válida.
 * - No redirige (la UI decide qué hacer).
 * - Retorna el objeto de sesión o null.
 */
export async function checkSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session ?? null;
  } catch {
    return null;
  }
}

/**
 * login(email, password)
 * - Inicia sesión con email/contraseña de Supabase Auth.
 * - Lanza error si falla.
 */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data?.session ?? null;
}

/**
 * logout()
 * - Cierra sesión de forma robusta y limpia cualquier residuo local.
 * - No redirige (la UI decide si recargar o navegar).
 */
export async function logout() {
  // 1) Intento de signOut vía Supabase
  try { await supabase.auth.signOut(); } catch {}
  // 2) Limpieza de tokens locales de Supabase (por si quedan colgados)
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") && (k.endsWith("-auth-token") || k.endsWith("-persist"))) {
        keys.push(k);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch {}
  try { sessionStorage.clear(); } catch {}
  return true;
}
