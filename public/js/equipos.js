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

// === [BEGIN ADD: Modal “Reportar falla” — V3 Día 3 · Parte 2] ==================
// Nota: este bloque puede pegarse **al final** de `public/js/equipos.js`.
// - No requiere imports nuevos (usa `supabase` ya importado en este módulo).
// - Usa delegación de eventos sobre `#eq-tbody` para botones dinámicos.
// - Busca el `equipo_id` desde `data-equipo-id` del botón o de la fila <tr> contenedora.
// - Terminología UI: “ensamblar/ensamblado”.

// Utilidades defensivas (solo se definen si no existen)
const $ = window.$ || ((s, r = document) => r.querySelector(s));
const $$ = window.$$ || ((s, r = document) => [...r.querySelectorAll(s)]);

if (typeof window.parsePgErrorMessage !== "function") {
  window.parsePgErrorMessage = function parsePgErrorMessage(msg) {
    if (!msg) return { code: "error", text: "Error desconocido" };
    const m = String(msg).match(/^(\d{3}):\s*(.*)$/);
    return m ? { code: m[1], text: m[2] } : { code: "error", text: String(msg) };
  };
}

if (typeof window.flash !== "function") {
  window.flash = function flash(message = "", ms = 1800) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText =
      "position:fixed;right:16px;bottom:16px;background:#1f2937;color:#fff;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.35;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.35)";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };
}

if (typeof window.openFormModal !== "function") {
  // Modal genérico con <dialog>
  window.openFormModal = function openFormModal(html, onSubmit, withSubmit = true) {
    const dlg = document.createElement("dialog");
    dlg.style.cssText =
      "border:none;border-radius:12px;padding:0;max-width:520px;width:calc(100% - 32px);background:#0b1220;color:#e5e7eb";
    dlg.innerHTML = `
      <form method="dialog" style="margin:0;padding:0;display:flex;flex-direction:column;gap:0">
        <header style="padding:14px 16px;border-bottom:1px solid #1f2937;font-weight:600">Reportar falla</header>
        <section style="padding:14px 16px">${html}</section>
        <footer style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #1f2937">
          <button type="button" data-cancel style="height:36px;padding:0 12px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:8px">Cancelar</button>
          ${
            withSubmit
              ? `<button type="submit" style="height:36px;padding:0 12px;background:#2563eb;color:white;border:none;border-radius:8px">Guardar</button>`
              : `<button type="button" data-close style="height:36px;padding:0 12px;background:#2563eb;color:white;border:none;border-radius:8px">Cerrar</button>`
          }
        </footer>
      </form>
    `;
    document.body.appendChild(dlg);
    const form = dlg.querySelector("form");

    // Cancelar nunca valida
    form.querySelector("[data-cancel]")?.addEventListener("click", () => dlg.close());
    form.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());

    if (withSubmit && typeof onSubmit === "function") {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = "Guardando…";
        try {
          await onSubmit(fd, { dialog: dlg, form, submitBtn });
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Guardar";
        }
      });
    }
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    return dlg;
  };
}

// —— Render del modal “Reportar falla” y llamada a RPC ————————————————
async function openReportarFallaModal(equipoId) {
  if (!equipoId) {
    alert("No se pudo identificar el equipo.");
    return;
  }

  // 1) Traer componentes **ensamblados** (vigencia abierta) del equipo
  const { data: ensamblados, error: qErr } = await supabase
    .from("equipo_componente")
    .select(
      `
      id,
      componente:componente_id (
        id,
        serie,
        tipo:tipo_componente_id ( nombre )
      )
    `
    )
    .eq("equipo_id", equipoId)
    .is("fecha_fin", null)
    .order("id", { ascending: true });

  if (qErr) {
    const { text } = parsePgErrorMessage(qErr.message);
    alert("No se pudieron cargar componentes ensamblados:\n" + text);
    return;
  }
  if (!ensamblados || ensamblados.length === 0) {
    alert("Este equipo no tiene componentes ensamblados.");
    return;
  }

  // 2) Construir el formulario (selector + detalle)
  const opts = ensamblados
    .map((row) => {
      const comp = row.componente;
      const tipo = comp?.tipo?.nombre || "Componente";
      const label = `${tipo} — ${comp?.serie || comp?.id}`;
      return `<option value="${comp.id}">${label}</option>`;
    })
    .join("");

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <label style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:12px;color:#9ca3af">Componente ensamblado</span>
        <select name="componente_id" required style="height:36px;background:#0b1220;border:1px solid #334155;border-radius:8px;color:#e5e7eb;padding:0 10px">
          ${opts}
        </select>
      </label>

      <label style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:12px;color:#9ca3af">Detalle de la falla</span>
        <textarea name="detalle" rows="4" required
          placeholder="Describe brevemente el síntoma o evento (fecha, operador, condiciones)…"
          style="resize:vertical;min-height:96px;background:#0b1220;border:1px solid #334155;border-radius:8px;color:#e5e7eb;padding:8px 10px"></textarea>
      </label>
    </div>
  `;

  openFormModal(html, async (fd, ctx) => {
    const componenteId = fd.get("componente_id");
    const detalle = String(fd.get("detalle") || "").trim();

    if (!componenteId || !detalle) {
      alert("Completa todos los campos.");
      return;
    }

    // 3) Llamar RPC: rpc_equipo_reportar_falla(p_equipo_id, p_componente_id, p_detalle)
    const { data, error } = await supabase.rpc("rpc_equipo_reportar_falla", {
      p_equipo_id: equipoId,
      p_componente_id: componenteId,
      p_detalle: detalle,
    });

    if (error) {
      const { code, text } = parsePgErrorMessage(error.message);
      if (code === "403") alert("Sin permisos para reportar falla en este equipo.");
      else if (code === "409") alert("No se puede reportar: reglas de negocio no satisfechas.\n" + text);
      else if (code === "422") alert("Datos inválidos:\n" + text);
      else alert("Error al reportar la falla:\n" + text);
      return;
    }

    // 4) OK → cerrar y refrescar
    ctx.dialog.close();
    flash("Falla reportada");
    // Si tu listado expone una función global para refrescar, intenta llamarla.
    // Estas líneas son defensivas y no rompen si no existen:
    (window.refreshEquipos && typeof window.refreshEquipos === "function") && window.refreshEquipos();
    document.dispatchEvent(new CustomEvent("equipos:falla-reportada", { detail: { equipoId, componenteId: componenteId } }));
  });
}

// —— Delegación de eventos para botón “Reportar falla” ————————————————
// Requiere que el botón tenga alguno de estos atributos/clases:
//  - data-action="falla"
//  - .btn-falla
//  y que provea `data-equipo-id` **o** que la fila <tr> contenedora lo tenga.
(function installReportarFallaHandler() {
  const tbody = $("#eq-tbody");
  if (!tbody) return; // la pestaña podría no estar montada aún

  tbody.addEventListener("click", (ev) => {
    const btn = ev.target.closest('[data-action="falla"], .btn-falla');
    if (!btn) return;

    const tr = btn.closest("tr");
    const equipoId =
      btn.dataset.equipoId ||
      tr?.dataset.equipoId ||
      btn.getAttribute("data-eq") ||
      null;

    openReportarFallaModal(equipoId);
  });
})();

// === [END ADD] ===============================================================
// === [BEGIN PATCH: Agregar botón “Reportar falla” en filas de Equipos] ==============
// Asunción conservadora: cada <tr> de #eq-tbody tiene data-equipo-id; si no hay
// celda de acciones con clase .eq-actions, se usa la **última celda** para insertar el botón.
// Esto evita tocar tu render existente y es idempotente.

(function installFallaButtonsEnhancer() {
  const $ = window.$ || ((s, r = document) => r.querySelector(s));
  const $$ = window.$$ || ((s, r = document) => [...r.querySelectorAll(s)]);

  const tbody = $("#eq-tbody");
  if (!tbody) return;

  function ensureFallaButtons(root = tbody) {
    const rows = $$("tr[data-equipo-id]", root);
    for (const tr of rows) {
      const equipoId = tr.dataset.equipoId;
      if (!equipoId) continue;

      // Busca contenedor de acciones o usa la última celda
      let actionsCell = tr.querySelector(".eq-actions");
      if (!actionsCell) {
        const tds = tr.querySelectorAll("td");
        if (tds.length === 0) continue;
        actionsCell = tds[tds.length - 1];
      }
      if (!actionsCell) continue;

      // Evita duplicados: ya existe un botón para este equipo
      const already = actionsCell.querySelector('[data-action="falla"]');
      if (already) {
        // Asegura que tenga el data-equipo-id correcto
        already.dataset.equipoId = equipoId;
        continue;
      }

      // Crea botón compacto “Reportar falla”
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Reportar falla";
      btn.dataset.action = "falla";
      btn.dataset.equipoId = equipoId;
      btn.className = "btn-falla";
      btn.style.cssText =
        "height:28px;padding:0 10px;margin-left:6px;background:#374151;color:#e5e7eb;border:1px solid #4b5563;border-radius:8px;font-size:12px;line-height:1.35";
      actionsCell.appendChild(btn);
    }
  }

  // Primera pasada
  ensureFallaButtons();

  // Observa cambios para listas re-renderizadas
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList" && (m.addedNodes?.length || m.removedNodes?.length)) {
        ensureFallaButtons();
      }
    }
  });
  mo.observe(tbody, { childList: true, subtree: true });

  // Si tu código emite eventos tras refrescar equipos, engancha aquí también
  document.addEventListener("equipos:list-refreshed", () => ensureFallaButtons());
})();

// === [END PATCH] =====================================================================


