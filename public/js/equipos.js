# path: public/js/equipos.js
import { supabase } from "./supabaseClient.js";

/* ========== Utilidad de modales ========== */
/**
 * Abre un <dialog> con un formulario.
 * - html: contenido interior del <form> (inputs, selects, etc.)
 * - onSubmit(FormData): callback al guardar
 * - withSubmit: si false, solo muestra botón "Cerrar" (sin validación)
 */
function openFormModal(html, onSubmit, withSubmit = true) {
  const dlg  = document.querySelector("#modal-form");
  const form = document.querySelector("#modal-form-content");

  form.innerHTML = html + (
    withSubmit
      ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
           <button type="button" id="modal-cancel">Cancelar</button>
           <button type="submit" id="modal-submit">Guardar</button>
         </div>`
      : `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
           <button type="button" id="modal-cancel">Cerrar</button>
         </div>`
  );

  // Cierra el modal sin validar
  form.querySelector("#modal-cancel").onclick = () => dlg.close();

  // Maneja submit solo si corresponde
  form.onsubmit = withSubmit ? async (e) => {
    e.preventDefault();
    try {
      await onSubmit?.(new FormData(form));
      dlg.close();
    } catch (err) {
      alert(err?.message || err);
    }
  } : null;

  dlg.showModal();
}

/* ========== Datos / Render ========== */
/**
 * Obtiene equipos visibles (RLS aplica), su centro vigente y componentes ensamblados.
 */
export async function fetchEquipos() {
  // Equipos
  const { data: equipos, error } = await supabase
    .from("equipos")
    .select("id,codigo,rol_equipo_id,rol:rol_equipo_id(nombre),descripcion,is_active")
    .order("codigo");

  if (error) {
    alert(`Error al listar equipos:\n${error.message}`);
    return [];
  }

  const ids = (equipos || []).map(e => e.id);

  // Asignación vigente → centro nombre
  let asign = [];
  if (ids.length) {
    const { data: a, error: e2 } = await supabase
      .from("equipo_asignacion")
      .select("equipo_id, centro:centro_id(nombre)")
      .is("fecha_fin", null)
      .in("equipo_id", ids);
    if (e2) alert(`Error al cargar asignaciones:\n${e2.message}`);
    asign = a || [];
  }

  // Componentes ensamblados por equipo
  for (const e of (equipos || [])) {
    e._centro_nombre = asign.find(x => x.equipo_id === e.id)?.centro?.nombre ?? "—";

    const { data: comps, error: e3 } = await supabase
      .from("equipo_componente")
      .select("id, es_opcional, componente:componente_id(serie, tipo:tipo_componente_id(nombre))")
      .eq("equipo_id", e.id)
      .is("fecha_fin", null);
    if (e3) alert(`Error al cargar componentes del equipo ${e.codigo}:\n${e3.message}`);

    e._comps = (comps || []).map(c => {
      const nom = c.componente?.tipo?.nombre ?? "Tipo";
      const serie = c.componente?.serie ?? "";
      const opc = c.es_opcional ? " (opcional)" : "";
      return `${nom} · ${serie}${opc}`;
    });
  }

  return equipos || [];
}

/**
 * Renderiza la tabla de equipos.
 */
export function renderEquipos(equipos) {
  const tbody = document.querySelector("#eq-tbody");
  if (!equipos.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Sin resultados</td></tr>`;
    return;
  }

  tbody.innerHTML = equipos.map(e => `
    <tr>
      <td>
        <strong>${e.codigo}</strong><br>
        <small class="muted">${e.is_active ? "Activo" : "Inactivo"}</small>
      </td>
      <td data-rol="${e.rol_equipo_id}">${e.rol?.nombre ?? "—"}</td>
      <td>${e._centro_nombre}</td>
      <td>${e._comps.map(c => `<span class="tag">${c}</span>`).join("") || "—"}</td>
      <td class="actions">
        <button class="small" data-act="editar"    data-id="${e.id}">✏️ Editar</button>
        <button class="small" data-act="ensamblar" data-id="${e.id}">🧩 Ensamblar</button>
        <button class="small" data-act="quitar"    data-id="${e.id}">➖ Quitar</button>
        <button class="small" data-act="falla"     data-id="${e.id}">⚠️ Falla</button>
      </td>
    </tr>
  `).join("");
}

/* ========== Modales ========== */
/**
 * Crear equipo (super-roles): usa rpc_equipo_crear
 */
async function modalCrearEquipo(onDone) {
  const { data: roles, error: e1 } = await supabase
    .from("rol_equipo")
    .select("id,nombre")
    .order("nombre");
  if (e1) throw new Error(e1.message);

  const { data: centros, error: e2 } = await supabase
    .from("centros")
    .select("id,nombre")
    .order("nombre");
  if (e2) throw new Error(e2.message);

  openFormModal(`
    <h4 style="margin:0 0 8px">Crear equipo</h4>
    <label>Código
      <input name="codigo" required>
    </label>
    <label>Rol
      <select name="rol" required>
        <option value="">—</option>
        ${(roles || []).map(r => `<option value="${r.id}">${r.nombre}</option>`).join("")}
      </select>
    </label>
    <label>Descripción
      <textarea name="desc" rows="3" placeholder="Opcional"></textarea>
    </label>
    <label>Centro (asignación vigente)
      <select name="centro" required>
        <option value="">—</option>
        ${(centros || []).map(c => `<option value="${c.id}">${c.nombre}</option>`).join("")}
      </select>
    </label>
  `, async (fd) => {
    const payload = {
      p_codigo: fd.get("codigo"),
      p_rol_equipo_id: fd.get("rol"),
      p_descripcion: fd.get("desc") || "",
      p_centro_id: fd.get("centro"),
    };
    const { data, error } = await supabase.rpc("rpc_equipo_crear", payload);
    if (error) throw new Error(error.message);
    onDone?.(data);
  });
}

/**
 * Editar equipo (super-roles): usa rpc_equipo_editar
 */
async function modalEditarEquipo(equipoId, onDone) {
  const { data: e1, error } = await supabase
    .from("equipos")
    .select("id,codigo,rol_equipo_id,descripcion,is_active")
    .eq("id", equipoId)
    .single();
  if (error) throw new Error(error.message);

  openFormModal(`
    <h4 style="margin:0 0 8px">Editar equipo</h4>
    <label>Código
      <input name="codigo" required value="${e1.codigo}">
    </label>
    <label>Descripción
      <textarea name="desc" rows="3">${e1.descripcion ?? ""}</textarea>
    </label>
    <label>Activo
      <select name="activo">
        <option value="true"  ${e1.is_active ? "selected" : ""}>Sí</option>
        <option value="false" ${!e1.is_active ? "selected" : ""}>No</option>
      </select>
    </label>
    <small class="muted">El rol del equipo no se cambia aquí (solo datos básicos).</small>
  `, async (fd) => {
    const payload = {
      p_equipo_id: equipoId,
      p_codigo: fd.get("codigo"),
      p_rol_equipo_id: e1.rol_equipo_id,
      p_descripcion: fd.get("desc") || "",
      p_is_active: fd.get("activo") === "true",
    };
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_editar", payload);
    if (e2) throw new Error(e2.message);
    onDone?.(data);
  });
}

/**
 * Ensamblar componente (super-roles): usa rpc_equipo_agregar_componente
 * - Si no hay componentes disponibles, muestra modal informativo sin submit.
 */
async function modalEnsamblar(equipoId, onDone) {
  const { data: comps, error } = await supabase
    .from("componentes")
    .select("id,serie,is_active,centro_id,tipo:tipo_componente_id(nombre),estado:estado_componente_id(nombre)")
    .order("serie")
    .limit(200);
  if (error) throw new Error(error.message);

  if (!comps || !comps.length) {
    openFormModal(`
      <h4 style="margin:0 0 8px">Ensamblar componente</h4>
      <p class="muted">No hay componentes disponibles para ensamblar.</p>
    `, null, /* withSubmit */ false);
    return;
  }

  openFormModal(`
    <h4 style="margin:0 0 8px">Ensamblar componente</h4>
    <label>Componente
      <select name="comp" required>
        <option value="">—</option>
        ${(comps || []).map(c => `
          <option value="${c.id}">
            ${c.serie} · ${c.tipo?.nombre ?? "Tipo?"} · estado:${c.estado?.nombre ?? "—"} ${c.is_active ? "" : "· inactivo"}
          </option>
        `).join("")}
      </select>
    </label>
    <label>Marcar como opcional
      <select name="opc">
        <option value="false">No</option>
        <option value="true">Sí</option>
      </select>
    </label>
  `, async (fd) => {
    const payload = {
      p_equipo_id: equipoId,
      p_componente_id: fd.get("comp"),
      p_es_opcional: fd.get("opc") === "true",
    };
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_agregar_componente", payload);
    if (e2) throw new Error(e2.message);
    onDone?.(data);
  });
}

/**
 * Quitar componente ensamblado (super-roles): usa rpc_equipo_quitar_componente
 */
async function modalQuitar(equipoId, onDone) {
  const { data: comps, error } = await supabase
    .from("equipo_componente")
    .select("componente:componente_id(id,serie,tipo:tipo_componente_id(nombre))")
    .eq("equipo_id", equipoId)
    .is("fecha_fin", null);
  if (error) throw new Error(error.message);

  if (!comps || !comps.length) {
    openFormModal(`
      <h4 style="margin:0 0 8px">Quitar componente</h4>
      <p class="muted">Este equipo no tiene componentes ensamblados.</p>
    `, null, /* withSubmit */ false);
    return;
  }

  openFormModal(`
    <h4 style="margin:0 0 8px">Quitar componente ensamblado</h4>
    <label>Componente ensamblado
      <select name="comp" required>
        <option value="">—</option>
        ${(comps || []).map(x => `
          <option value="${x.componente?.id}">
            ${x.componente?.serie} · ${x.componente?.tipo?.nombre}
          </option>
        `).join("")}
      </select>
    </label>
  `, async (fd) => {
    const payload = {
      p_equipo_id: equipoId,
      p_componente_id: fd.get("comp"),
    };
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_quitar_componente", payload);
    if (e2) throw new Error(e2.message);
    onDone?.(data);
  });
}

/**
 * Reportar falla desde equipo (centro + super-roles): usa rpc_equipo_reportar_falla
 */
async function modalFallaDesdeEquipo(equipoId) {
  const { data: comps, error } = await supabase
    .from("equipo_componente")
    .select("componente:componente_id(id,serie,tipo:tipo_componente_id(nombre))")
    .eq("equipo_id", equipoId)
    .is("fecha_fin", null);
  if (error) throw new Error(error.message);

  if (!comps || !comps.length) {
    openFormModal(`
      <h4 style="margin:0 0 8px">Reportar falla</h4>
      <p class="muted">Este equipo no tiene componentes ensamblados.</p>
    `, null, /* withSubmit */ false);
    return;
  }

  openFormModal(`
    <h4 style="margin:0 0 8px">Reportar falla</h4>
    <label>Componente ensamblado
      <select name="comp" required>
        <option value="">—</option>
        ${(comps || []).map(x => `
          <option value="${x.componente?.id}">
            ${x.componente?.serie} · ${x.componente?.tipo?.nombre}
          </option>
        `).join("")}
      </select>
    </label>
    <label>Detalle
      <textarea name="detalle" rows="3" required></textarea>
    </label>
  `, async (fd) => {
    const payload = {
      p_equipo_id: equipoId,
      p_componente_id: fd.get("comp"),
      p_detalle: fd.get("detalle"),
    };
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_reportar_falla", payload);
    if (e2) throw new Error(e2.message);
    alert(`Falla creada: ${data}`);
  });
}

/* ========== Listeners públicos ========== */
/**
 * Conecta la UI (botones toolbar y acciones por fila) con los modales.
 * @param {Function} requestReload - función que vuelve a cargar y renderizar la tabla de equipos.
 */
export function initEquiposUI(requestReload) {
  // Toolbar
  const btnCrear = document.querySelector("#eq-crear");
  const btnRef   = document.querySelector("#eq-refrescar");

  if (btnCrear) btnCrear.onclick = () => modalCrearEquipo(() => requestReload());
  if (btnRef)   btnRef.onclick   = () => requestReload();

  // Delegación en la tabla
  const tbody = document.querySelector("#eq-tbody");
  tbody.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const id  = b.dataset.id;
    const act = b.dataset.act;
    try {
      if (act === "editar")    await modalEditarEquipo(id, () => requestReload());
      if (act === "ensamblar") await modalEnsamblar(id, () => requestReload());
      if (act === "quitar")    await modalQuitar(id, () => requestReload());
      if (act === "falla")     await modalFallaDesdeEquipo(id);
    } catch (err) {
      alert(err?.message || err);
    }
  });
}



