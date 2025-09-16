import { supabase } from "./supabaseClient.js";

export async function fetchEquipos() {
  const { data, error } = await supabase
    .from("equipos")
    .select("id,codigo,rol:rol_equipo_id(nombre),is_active")
    .order("codigo");
  if (error) return [];
  for (const e of data) {
    const { data: comps } = await supabase
      .from("equipo_componente")
      .select("id,componente:componente_id(serie,tipo:tipo_componente_id(nombre))")
      .eq("equipo_id", e.id)
      .is("fecha_fin", null);
    e._comps = (comps || []).map(c => `${c.componente?.tipo?.nombre} · ${c.componente?.serie}`);
  }
  return data;
}

export function renderEquipos(equipos) {
  const tbody = document.querySelector("#eq-tbody");
  tbody.innerHTML = equipos.map(e => `
    <tr>
      <td><strong>${e.codigo}</strong></td>
      <td>${e.rol?.nombre ?? "—"}</td>
      <td>(centro pendiente)</td>
      <td>${e._comps.map(c=>`<span class="tag">${c}</span>`).join("") || "—"}</td>
      <td>
        <button data-act="editar" data-id="${e.id}">✏️ Editar</button>
        <button data-act="ensamblar" data-id="${e.id}">🧩 Ensamblar</button>
        <button data-act="falla" data-id="${e.id}">⚠️ Falla</button>
      </td>
    </tr>`).join("");
}
