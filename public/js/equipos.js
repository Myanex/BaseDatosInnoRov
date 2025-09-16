import { supabase } from "./supabaseClient.js";

export async function fetchEquipos() {
  // Equipos visibles (RLS ya aplica)
  const { data: equipos, error } = await supabase
    .from("equipos")
    .select("id,codigo,rol:rol_equipo_id(nombre),is_active")
    .order("codigo");
  if (error) return [];

  const ids = equipos.map(e => e.id);
  let asign = [];
  if (ids.length) {
    const { data: a } = await supabase
      .from("equipo_asignacion")
      .select("equipo_id, centro:centro_id(nombre)")
      .is("fecha_fin", null)
      .in("equipo_id", ids);
    asign = a || [];
  }

  for (const e of equipos) {
    e._centro_nombre = asign.find(a => a.equipo_id === e.id)?.centro?.nombre ?? "—";
    const { data: comps } = await supabase
      .from("equipo_componente")
      .select("id,componente:componente_id(serie,tipo:tipo_componente_id(nombre))")
      .eq("equipo_id", e.id)
      .is("fecha_fin", null);
    e._comps = (comps || []).map(c => `${c.componente?.tipo?.nombre} · ${c.componente?.serie}`);
  }
  return equipos;
}

export function renderEquipos(equipos) {
  const tbody = document.querySelector("#eq-tbody");
  tbody.innerHTML = equipos.map(e => `
    <tr>
      <td><strong>${e.codigo}</strong><br><small class="muted">${e.is_active ? "Activo" : "Inactivo"}</small></td>
      <td>${e.rol?.nombre ?? "—"}</td>
      <td>${e._centro_nombre}</td>
      <td>${e._comps.map(c=>`<span class="tag">${c}</span>`).join("") || "—"}</td>
      <td>
        <button data-act="editar" data-id="${e.id}">✏️ Editar</button>
        <button data-act="ensamblar" data-id="${e.id}">🧩 Ensamblar</button>
        <button data-act="falla" data-id="${e.id}">⚠️ Falla</button>
      </td>
    </tr>`).join("");
}

