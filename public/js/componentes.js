// public/js/componentes.js
import { supabase } from "./supabaseClient.js";

const PAGE_SIZE = 10;

export async function getSessionProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("email, role, centro_id, empresa_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return { user, profile: data };
}

export async function fetchComponentes({ page = 1, estado = "", tipo = "", soloActivos = true }) {
  const PAGE_SIZE = 10;
  let q = supabase
    .from("componentes") // ← usar tabla base, RLS estricta
    .select("id, serie, tipo_componente_id, estado_componente_id, centro_id, is_active, created_at", { count: "exact" });

  if (soloActivos) q = q.eq("is_active", true);

  // Estos filtros ahora son por ID/serie (la tabla no tiene nombres).
  // Si necesitas filtrar por NOMBRE de tipo/estado, lo vemos en el siguiente paso con joins de PostgREST.
  if (estado) q = q.ilike("estado_componente_id", `%${estado}%`); // opcional si usas UUIDs => puedes quitar esta línea
  if (tipo)   q = q.ilike("serie", `%${tipo}%`); // filtro simple sobre la serie por ahora

  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const { data, error, count } = await q.range(from, to).order("created_at", { ascending: false });
  if (error) throw error;

  // Adaptamos los nombres que mostraba la vista a lo que hay en la tabla
  const rows = (data ?? []).map(r => ({
    id: r.id,
    serie: r.serie,
    tipo_nombre: r.tipo_componente_id,     // por ahora mostramos el ID
    estado_nombre: r.estado_componente_id, // por ahora mostramos el ID
    centro_nombre: r.centro_id,            // por ahora mostramos el ID
    is_active: r.is_active
  }));

  return {
    rows,
    count: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  };
}


export async function bajaLogica(id) {
  const { data, error } = await supabase.rpc("rpc_componente_baja_logica", {
    p_componente_id: id,
    p_marcar_estado_baja: true,
  });
  if (error) throw error;
  return data;
}

export async function reportarFalla(id, detalle) {
  const { data, error } = await supabase.rpc("rpc_falla_registrar", {
    p_componente_id: id,
    p_detalle: detalle,
  });
  if (error) throw error;
  return data;
}
