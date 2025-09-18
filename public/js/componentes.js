import { supabase } from "./supabaseClient.js";

// Modal util
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

  form.querySelector("#modal-cancel").onclick = () => dlg.close();
  form.onsubmit = withSubmit ? async (e)=>{
    e.preventDefault();
    try { await onSubmit?.(new FormData(form)); dlg.close(); }
    catch(err){ alert(err.message || err); }
  } : null;

  dlg.showModal();
}

export async function fetchComponentes() {
  const { data, error } = await supabase
    .from("componentes")
    .select("id,serie,is_active,centro_id,tipo:tipo_componente_id(nombre),estado:estado_componente_id(nombre)")
    .order("serie");
  if (error) return [];
  return data;
}

export function renderComponentes(comps) {
  const tbody = document.querySelector("#co-tbody");
  tbody.innerHTML = comps.map(c => `
    <tr>
      <td><strong>${c.serie ?? "(s/serie)"}</strong><br><small class="muted">${c.is_active ? "Activo" : "Inactivo"}</small></td>
      <td>${c.tipo?.nombre ?? "—"}</td>
      <td>${c.estado?.nombre ?? "—"}</td>
      <td>${c.centro_id ?? "Ensamblado (hereda centro por equipo)"}</td>
      <td class="actions">
        <button class="small" data-act="co-falla" data-id="${c.id}" data-serie="${c.serie ?? ""}">⚠️ Falla</button>
        <button class="small" data-act="co-baja" data-id="${c.id}" data-serie="${c.serie ?? ""}">🗑️ Baja</button>
      </td>
    </tr>`).join("");
}

async function modalFallaComponente(compId, serie){
  openFormModal(`
    <h4 style="margin:0 0 8px">Reportar falla</h4>
    <p class="muted" style="margin:0 0 6px">Componente: <strong>${serie || compId}</strong></p>
    <label>Detalle<textarea name="detalle" rows="3" required></textarea></label>
  `, async (fd)=>{
    const { data, error } = await supabase.rpc("rpc_falla_registrar", {
      p_componente_id: compId,
      p_detalle: fd.get("detalle")
    });
    if(error) throw new Error(error.message);
    alert(`Falla creada: ${data}`);
  });
}

async function modalConfirmBaja(compId, serie, onDone){
  openFormModal(`
    <h4 style="margin:0 0 8px">Dar de baja lógica</h4>
    <p>¿Confirmas dar de baja el componente <strong>${serie || compId}</strong>?</p>
  `, async ()=>{
    const { data, error } = await supabase.rpc("rpc_componente_baja_logica", {
      p_componente_id: compId,
      p_marcar_estado_baja: true
    });
    if(error) throw new Error(error.message);
    onDone?.(data);
  });
}

export function initComponentesUI(requestReload){
  const btnRefrescar = document.querySelector("#co-refrescar");
  if (btnRefrescar) btnRefrescar.onclick = () => requestReload?.();

  const tbody = document.querySelector("#co-tbody");
  if (!tbody) return;

  tbody.__coRequestReload = requestReload;
  if (!tbody.__coListener) {
    tbody.__coListener = async (ev)=>{
      const b = ev.target.closest("button[data-act]"); if(!b) return;
      const id = b.dataset.id, act = b.dataset.act, serie = b.dataset.serie;
      const reload = tbody.__coRequestReload;
      try{
        if(act==="co-falla") await modalFallaComponente(id, serie);
        if(act==="co-baja")  await modalConfirmBaja(id, serie, ()=>reload?.());
      }catch(err){
        alert(err.message || err);
      }
    };
    tbody.addEventListener("click", tbody.__coListener);
  }
}

