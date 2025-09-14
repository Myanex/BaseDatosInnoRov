import { supabase } from "../lib/supabaseClient.js";

const PAGE_SIZE = 10;

export async function getSessionProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // Leer perfil
  const { data, error } = await supabase
    .from('profiles')
    .select('email, role, centro_id, empresa_id, is_active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return { user, profile: data };
}

export async function fetchComponentes({ page=1, estado='', tipo='', soloActivos=true }) {
  // Server-side paginado simple con filtros básicos
  let q = supabase
    .from('componentes_view_list') // RECOMENDADO: crear vista para join a nombres; si no, usar tabla y joins client.
    .select('*', { count: 'exact' });

  if (estado) q = q.ilike('estado_nombre', `%${estado}%`);
  if (tipo)   q = q.ilike('tipo_nombre', `%${tipo}%`);
  if (soloActivos) q = q.eq('is_active', true);

  const from = (page-1)*PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const { data, error, count } = await q.range(from, to).order('created_at', { ascending: false });
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0, page, pages: Math.max(1, Math.ceil((count ?? 0)/PAGE_SIZE)) };
}

export async function bajaLogica(id) {
  const { data, error } = await supabase.rpc('rpc_componente_baja_logica', {
    p_componente_id: id,
    p_marcar_estado_baja: true
  });
  if (error) throw error;
  return data;
}

export async function reportarFalla(id, detalle) {
  const { data, error } = await supabase.rpc('rpc_falla_registrar', {
    p_componente_id: id,
    p_detalle: detalle
  });
  if (error) throw error;
  return data;
}
