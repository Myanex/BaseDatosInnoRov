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

  // Embedding con alias:
  // - tipo:   tipo_componente_id(nombre)
  // - estado: estado_componente_id(nombre)
  // - centro: centros(nombre) a través de centro_id
  //
  // IMPORTANTE: Esto asume que existen FKs:
  //   componentes.tipo_componente_id  -> tipo_componente.id
  //   componentes.estado_componente_id-> estado_componente.id
  //   componentes.centro_id           -> centros.id
  //
  // Y que las tablas tipo_componente / estado_componente / centros permiten SELECT (ya aplicado).

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

  // Filtros por NOMBRE en tablas relacionadas (vía alias)
  if (tipo)   q = q.ilike("tipo.nombre", `%${tipo}%`);
  if (estado) q = q.ilike("estado.nombre", `%${estado}%`);

  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const { data, error, count } = await q
    .range(from, to)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Adaptar a las columnas que espera la grilla
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
