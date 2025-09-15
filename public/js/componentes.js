// public/js/componentes.js
import { supabase } from "./supabaseClient.js";

const PAGE_SIZE = 10;

/**
 * Lee usuario y perfil (profiles) del usuario autenticado.
 * RLS en profiles permite: el propio perfil o superroles (admin/dev/oficina).
 */
export async function getSessionProfile() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("email, role, centro_id, empresa_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return { user, profile: data };
}

/**
 * Lista componentes paginados desde la TABLA BASE `componentes`
 * con nombres de tipo/estado/centro via joins de PostgREST.
 * Esto respeta las policies RLS de `componentes`.
 */
export async function fetchComponentes({ page = 1, estado = "", tipo = "", soloActivos = true }) {
  let q = supabase
    .from("componentes")
    .select(`
      id,
      serie,
      is_active,
      created_at,
      tipo:tipo_componente_id ( nombre ),
      estado:estado_componente_id ( nombre ),
      centro:centro_id ( nombre )
    `, { count: "exact" });

  if (soloActivos) q = q.eq("is_active", true);
  if (tipo)   q = q.ilike("tipo.nombre", `%${tipo}%`);
  if (estado) q = q.ilike("estado.nombre", `%${estado}%`);

  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const { data, error, count } = await q
    .range(from, to)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []).map(r => ({
    id: r.id,
    serie: r.serie,
    tipo_nombre: r?.tipo?.nombre ?? "—",
    estado_nombre: r?.estado?.nombre ?? "—",
    centro_nombre: r?.centro?.nombre ?? "—",
    is_active: r.is_active
  }));

  return {
    rows,
    count: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  };
}

/**
 * Ejecuta la baja lógica de un componente (RPC con reglas de negocio).
 */
export async function bajaLogica(id) {
  const { data, error } = await supabase.rpc("rpc_componente_baja_logica", {
    p_componente_id: id,
    p_marcar_estado_baja: true
  });
  if (error) throw error;
  return data;
}

/**
 * Reporta una falla para un componente dentro del alcance del centro (RLS en RPC).
 */
export async function reportarFalla(id, detalle) {
  const { data, error } = await supabase.rpc("rpc_falla_registrar", {
    p_componente_id: id,
    p_detalle: detalle
  });
  if (error) throw error;
  return data;
}

