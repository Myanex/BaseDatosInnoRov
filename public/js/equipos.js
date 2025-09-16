import { supabase } from "./supabaseClient.js";

// Utilidad modal
function openFormModal(html, onSubmit, withSubmit = true) {
  const dlg = document.querySelector("#modal-form");
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

  // Cerrar sin validar
  form.querySelector("#modal-cancel").onclick = () => dlg.close();

  // Solo enganchar submit cuando hay botón de guardar
  form.onsubmit = withSubmit ? async (e) => {
    e.preventDefault();
    try { await onSubmit?.(new FormData(form)); dlg.close(); }
    catch(err){ alert(err.message || err); }
  } : null;

  dlg.showModal();
}

// =========== Data ===========
export async function fetchEquipos() {
  const { data: equipos, error } = await supabase
    .from("equipos")
    .select("id,codigo,rol_equipo_id,rol:rol_equipo_id(nombre),is_active")
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
  const wrap = document.createElement('div');
  wrap.className = 'acciones flex gap-2';
  const tbody = document.querySelector("#eq-tbody");
  tbody.innerHTML = equipos.map(e => `
    <tr>
      <td><strong>${e.codigo}</strong><br><small class="muted">${e.is_active ? "Activo" : "Inactivo"}</small></td>
      <td data-rol="${e.rol_equipo_id}">${e.rol?.nombre ?? "—"}</td>
      <td>${e._centro_nombre}</td>
      <td>${e._comps.map(c=>`<span class="tag">${c}</span>`).join("") || "—"}</td>
      <td class="actions">
        <button class="small" data-act="editar" data-id="${e.id}">✏️ Editar</button>
        <button class="small" data-act="ensamblar" data-id="${e.id}">🧩 Ensamblar</button>
        <button class="small" data-act="quitar" data-id="${e.id}">➖ Quitar</button>
        <button class="small" data-act="falla" data-id="${e.id}">⚠️ Falla</button>
      </td>
    </tr>`).join("");
  
  const btnFalla = document.createElement('button');
  btnFalla.className = 'btn-secondary';
  btnFalla.textContent = 'Reportar falla';
  btnFalla.addEventListener('click', () => openModalFallaEquipo(equipo));
  wrap.appendChild(btnFalla);

  return wrap;
}

// =========== Modales ===========
async function modalCrearEquipo(onDone){
  // Catálogos
  const { data: roles } = await supabase.from("rol_equipo").select("id,nombre").order("nombre");
  const { data: centros } = await supabase.from("centros").select("id,nombre").order("nombre");

  openFormModal(`
    <h4 style="margin:0 0 8px">Crear equipo</h4>
    <label>Código<input name="codigo" required></label>
    <label>Rol
      <select name="rol" required>
        <option value="">—</option>
        ${(roles||[]).map(r=>`<option value="${r.id}">${r.nombre}</option>`).join("")}
      </select>
    </label>
    <label>Descripción<textarea name="desc" rows="3" placeholder="Opcional"></textarea></label>
    <label>Centro (asignación vigente)
      <select name="centro" required>
        <option value="">—</option>
        ${(centros||[]).map(c=>`<option value="${c.id}">${c.nombre}</option>`).join("")}
      </select>
    </label>
  `, async (fd)=>{
    const { data, error } = await supabase.rpc("rpc_equipo_crear", {
      p_codigo: fd.get("codigo"),
      p_rol_equipo_id: fd.get("rol"),
      p_descripcion: fd.get("desc") || "",
      p_centro_id: fd.get("centro"),
    });
    if(error) throw new Error(error.message);
    onDone?.(data);
  });
}

async function modalEditarEquipo(equipoId, onDone){
  const { data: e1, error } = await supabase.from("equipos")
    .select("id,codigo,rol_equipo_id,descripcion,is_active")
    .eq("id", equipoId).single();
  if(error) throw new Error(error.message);

  openFormModal(`
    <h4 style="margin:0 0 8px">Editar equipo</h4>
    <label>Código<input name="codigo" required value="${e1.codigo}"></label>
    <label>Descripción<textarea name="desc" rows="3">${e1.descripcion ?? ""}</textarea></label>
    <label>Activo
      <select name="activo">
        <option value="true" ${e1.is_active?'selected':''}>Sí</option>
        <option value="false" ${!e1.is_active?'selected':''}>No</option>
      </select>
    </label>
    <small class="muted">El rol del equipo no se cambia aquí (solo datos básicos).</small>
  `, async (fd)=>{
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_editar", {
      p_equipo_id: equipoId,
      p_codigo: fd.get("codigo"),
      p_rol_equipo_id: e1.rol_equipo_id,
      p_descripcion: fd.get("desc") || "",
      p_is_active: fd.get("activo")==="true"
    });
    if(e2) throw new Error(e2.message);
    onDone?.(data);
  });
}

async function modalEnsamblar(equipoId, onDone){
  const { data: comps, error } = await supabase
    .from("componentes")
    .select("id,serie,is_active,centro_id,tipo:tipo_componente_id(nombre),estado:estado_componente_id(nombre)")
    .order("serie").limit(200);
  if(error) throw new Error(error.message);

  // Si no hay componentes disponibles, abrir modal informativo sin submit
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
        ${(comps||[]).map(c=>`
          <option value="${c.id}">
            ${c.serie} · ${c.tipo?.nombre ?? 'Tipo?'} · estado:${c.estado?.nombre ?? '—'} ${c.is_active?'':'· inactivo'}
          </option>`).join("")}
      </select>
    </label>
    <label>Marcar como opcional
      <select name="opc">
        <option value="false">No</option>
        <option value="true">Sí</option>
      </select>
    </label>
  `, async (fd)=>{
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_agregar_componente", {
      p_equipo_id: equipoId,
      p_componente_id: fd.get("comp"),
      p_es_opcional: fd.get("opc")==="true"
    });
    if(e2) throw new Error(e2.message);
    onDone?.(data);
  }, /* withSubmit */ true);
}

async function modalQuitar(equipoId, onDone){
  const { data: comps, error } = await supabase
    .from("equipo_componente")
    .select("componente:componente_id(id,serie,tipo:tipo_componente_id(nombre))")
    .eq("equipo_id", equipoId).is("fecha_fin", null);
  if(error) throw new Error(error.message);

  openFormModal(`
    <h4 style="margin:0 0 8px">Quitar componente ensamblado</h4>
    <label>Componente ensamblado
      <select name="comp" required>
        <option value="">—</option>
        ${(comps||[]).map(x=>`<option value="${x.componente?.id}">${x.componente?.serie} · ${x.componente?.tipo?.nombre}</option>`).join("")}
      </select>
    </label>
  `, async (fd)=>{
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_quitar_componente", {
      p_equipo_id: equipoId,
      p_componente_id: fd.get("comp"),
    });
    if(e2) throw new Error(e2.message);
    onDone?.(data);
  });
}

async function modalFallaDesdeEquipo(equipoId){
  const { data: comps, error } = await supabase
    .from("equipo_componente")
    .select("componente:componente_id(id,serie,tipo:tipo_componente_id(nombre))")
    .eq("equipo_id", equipoId).is("fecha_fin", null);
  if(error) throw new Error(error.message);

  openFormModal(`
    <h4 style="margin:0 0 8px">Reportar falla</h4>
    <label>Componente ensamblado
      <select name="comp" required>
        <option value="">—</option>
        ${(comps||[]).map(x=>`<option value="${x.componente?.id}">${x.componente?.serie} · ${x.componente?.tipo?.nombre}</option>`).join("")}
      </select>
    </label>
    <label>Detalle<textarea name="detalle" rows="3" required></textarea></label>
  `, async (fd)=>{
    const { data, error: e2 } = await supabase.rpc("rpc_equipo_reportar_falla", {
      p_equipo_id: equipoId,
      p_componente_id: fd.get("comp"),
      p_detalle: fd.get("detalle")
    });
    if(e2) throw new Error(e2.message);
    alert(`Falla creada: ${data}`);
  });
}

<script>
/* --- Utilidades DOM de modal (si ya existen funciones equivalentes, puedes reutilizarlas) --- */
const $modalFalla   = document.getElementById('modalFallaEquipo');
const $selCompFalla = document.getElementById('fallaEquipoComponente');
const $txtDetFalla  = document.getElementById('fallaEquipoDetalle');
const $ttlFalla     = document.getElementById('fallaEquipoTitulo');
const $btnFallaOK   = document.getElementById('btnFallaEquipoEnviar');
const $btnFallaNo   = document.getElementById('btnFallaEquipoCancelar');

let _equipoFallaCtx = null; // { id, codigo }

/**
 * Abre modal de falla para un equipo.
 * Carga componentes ensamblados vigentes en ese equipo.
 */
async function openModalFallaEquipo(equipo) {
  _equipoFallaCtx = { id: equipo.id, codigo: equipo.codigo };
  $ttlFalla.textContent = `Equipo: ${equipo.codigo}`;
  $txtDetFalla.value = '';

  // 1) Leer vínculos vigentes en equipo_componente
  const { data: vincs, error: errVincs } = await supabase
    .from('equipo_componente')
    .select('componente_id, fecha_fin')
    .eq('equipo_id', equipo.id)
    .is('fecha_fin', null);

  if (errVincs) {
    alert('Error cargando componentes ensamblados: ' + errVincs.message);
    return;
  }

  // 2) Si no hay componentes, bloquear flujo
  if (!vincs || vincs.length === 0) {
    alert('Este equipo no tiene componentes ensamblados vigentes.');
    return;
  }

  const compIds = vincs.map(v => v.componente_id);

  // 3) Traer info básica de componentes para mostrar en el selector
  const { data: comps, error: errComps } = await supabase
    .from('componentes')
    .select('id, serie, tipo_componente_id')
    .in('id', compIds);

  if (errComps) {
    alert('Error cargando componentes: ' + errComps.message);
    return;
  }

  // (opcional) nombre del tipo si tienes tabla y FK resueltas como join automático
  // Para máxima compatibilidad, mostramos: SERIE (ID abreviado)
  $selCompFalla.innerHTML = '';
  comps.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.serie ?? 'sin_serie'} • ${String(c.id).slice(0,8)}`;
    $selCompFalla.appendChild(opt);
  });

  $modalFalla.classList.remove('hidden');
}

/** Cierra modal */
function closeModalFallaEquipo() {
  $modalFalla.classList.add('hidden');
  _equipoFallaCtx = null;
}

/** Envía RPC para reportar falla */
async function submitFallaEquipo() {
  if (!_equipoFallaCtx) return;
  const componenteId = $selCompFalla.value;
  const detalle      = $txtDetFalla.value?.trim() || '';

  // Llamar RPC (Día 3 Parte 2 Paso 1)
  const { data, error } = await supabase.rpc('rpc_equipo_reportar_falla', {
    p_equipo_id: _equipoFallaCtx.id,
    p_componente_id: componenteId,
    p_detalle: detalle
  });

  if (error) {
    alert('No se pudo reportar la falla: ' + (error.message || JSON.stringify(error)));
    return;
  }

  // OK
  closeModalFallaEquipo();
  alert('Falla registrada con id: ' + data);

  // Opcional: refrescar listas/estado UI
  if (typeof listarEquipos === 'function') {
    listarEquipos().catch(console.error);
  }
}

/* Wire básico de botones del modal */
$btnFallaOK?.addEventListener('click', submitFallaEquipo);
$btnFallaNo?.addEventListener('click', closeModalFallaEquipo);
$modalFalla?.addEventListener('click', (e) => {
  if (e.target === $modalFalla) closeModalFallaEquipo();
});


// =========== Listeners ===========
export function initEquiposUI(requestReload){
  // Botones de toolbar
  document.querySelector("#eq-crear").onclick = ()=> modalCrearEquipo(()=>requestReload());
  document.querySelector("#eq-refrescar").onclick = ()=> requestReload();

  // Delegación de clicks en la tabla
  document.querySelector("#eq-tbody").addEventListener("click", async ev=>{
    const b = ev.target.closest("button[data-act]"); if(!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    try{
      if(act==="editar")   await modalEditarEquipo(id, ()=>requestReload());
      if(act==="ensamblar")await modalEnsamblar(id, ()=>requestReload());
      if(act==="quitar")   await modalQuitar(id, ()=>requestReload());
      if(act==="falla")    await modalFallaDesdeEquipo(id);
    }catch(err){
      alert(err.message || err);
    }
  });
}

