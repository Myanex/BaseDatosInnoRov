import { supabase } from "./supabaseClient.js";

export async function fetchComponentes() {
  const { data, error } = await supabase
    .from("componentes")
    .select("id,serie,is_active,tipo:tipo_componente_id(nombre),estado:estado_componente_id(nombre)")
    .order("serie");
  if (error) return [];
  return data;
}

export function renderComponentes(comps) {
  const tbody = document.querySelector("#co-tbody");
  tbody.innerHTML = comps.map(c => `
    <tr>
      <td>${c.serie}</td>
      <td>${c.tipo?.nombre ?? "—"}</td>
      <td>${c.estado?.nombre ?? "—"}</td>
      <td>${c.is_active ? "Activo" : "Inactivo"}</td>
      <td>
        <button data-act="co-falla" data-id="${c.id}">⚠️ Falla</button>
        <button data-act="co-baja" data-id="${c.id}">🗑️ Baja</button>
      </td>
    </tr>`).join("");
}

