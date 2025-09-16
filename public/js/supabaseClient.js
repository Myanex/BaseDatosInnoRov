import { ENV } from "../env.js";

export const supabase = window.supabase.createClient(
  ENV.SUPABASE_URL,
  ENV.SUPABASE_ANON_KEY
);

// rpc_whoami: { user_id, role, empresa_id, centro_id }
export async function whoami() {
  const { data, error } = await supabase.rpc("rpc_whoami");
  if (error) return null;
  return Array.isArray(data) && data.length ? data[0] : data;
}

// Perfil + nombre de centro (no ID)
export async function fetchProfileAndCentro(user_id, centro_id) {
  // Perfil (self): email, role (ya lo trae whoami), y si tienes más columnas (ej. nombre) las puedes agregar aquí
  const { data: prof } = await supabase
    .from("profiles")
    .select("email, role")
    .eq("user_id", user_id)
    .limit(1)
    .maybeSingle();

  // Centro nombre
  let centroNombre = null;
  if (centro_id) {
    const { data: c } = await supabase
      .from("centros")
      .select("nombre")
      .eq("id", centro_id)
      .limit(1)
      .maybeSingle();
    centroNombre = c?.nombre ?? null;
  }

  return {
    email: prof?.email ?? null,
    role: prof?.role ?? null,
    centro_nombre: centroNombre
  };
}
