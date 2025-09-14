import { supabase } from "./lib/supabaseClient.js";
import { getSessionProfile, fetchComponentes, bajaLogica, reportarFalla } from "./modules/componentes.js";

let state = {
  page: 1,
  filtros: { estado:'', tipo:'', soloActivos:true },
  perfil: null
};

const $ = (s)=>document.querySelector(s);
const tbody = $("#tbody");
const pageEl = $("#page");
const prevBtn = $("#prev");
const nextBtn = $("#next");

async function renderSession() {
  const el = document.getElementById('session-info');
  const profile = await getSessionProfile().catch(()=>null);
  state.perfil = profile?.profile ?? null;
  if (!profile) {
    el.textContent = "No autenticado";
  } else {
    el.textContent = `${profile.user.email} • rol: ${profile.profile?.role ?? '—'}`;
  }
}

async function renderGrid() {
  const { page, filtros } = state;
  const res = await fetchComponentes({ page, ...filtros }).catch(err => {
    console.error(err);
    alert(mapError(err));
    return { rows: [], count: 0, page:1, pages:1 };
  });

  tbody.innerHTML = res.rows.map(row => {
    const canBaja   = ['admin','dev','oficina'].includes(state.perfil?.role);
    const canFalla  = state.perfil?.role === 'centro' || ['admin','dev','oficina'].includes(state.perfil?.role);

    return `
      <tr>
        <td class="p-2">${row.serie ?? '—'}</td>
        <td class="p-2">${row.tipo_nombre ?? row.tipo_componente_id ?? '—'}</td>
        <td class="p-2">${row.estado_nombre ?? row.estado_componente_id ?? '—'}</td>
        <td class="p-2">${row.centro_nombre ?? '—'}</td>
        <td class="p-2">${row.is_active ? 'Sí' : 'No'}</td>
        <td class="p-2 flex gap-2">
          ${canBaja ? `<button data-act="baja" data-id="${row.id}" class="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500">Baja lógica</button>` : ''}
          ${canFalla ? `<button data-act="falla" data-id="${row.id}" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500">Reportar falla</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  pageEl.textContent = `${res.page}/${res.pages}`;
  prevBtn.disabled = res.page <= 1;
  nextBtn.disabled = res.page >= res.pages;
}

function mapError(err){
  const msg = err?.message?.toLowerCase() ?? '';
  if (msg.includes('rls') || err?.code === '42501') return 'No tiene permisos para esta acción (RLS).';
  if (msg.includes('movimiento activo')) return 'Movimiento activo: cierre/reciba antes de dar de baja.';
  if (msg.includes('montado')) return 'Desensamble el componente antes de dar de baja.';
  if (msg.includes('detalle requerido')) return 'Ingrese un detalle para la falla.';
  return 'Error: ' + (err?.message ?? 'desconocido');
}

async function ensureAuthUI() {
  document.getElementById('btn-login').onclick = async ()=>{
    const email = document.getElementById('email').value;
    const pass  = document.getElementById('pass').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) return alert('Login fallido: ' + error.message);
    await renderSession(); await renderGrid();
  };
  document.getElementById('btn-logout').onclick = async ()=>{
    await supabase.auth.signOut();
    await renderSession(); tbody.innerHTML = '';
  };
}

function bindGridActions() {
  tbody.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'baja') {
      if (!confirm('¿Dar de baja lógica este componente?')) return;
      const res = await bajaLogica(id).catch(err => alert(mapError(err)));
      if (res) await renderGrid();
    }
    if (btn.dataset.act === 'falla') {
      const detalle = prompt('Detalle de la falla:');
      if (!detalle) return;
      const res = await reportarFalla(id, detalle).catch(err => alert(mapError(err)));
      if (res) alert('Falla reportada.');
    }
  });
}

function bindFilters() {
  document.getElementById('f-estado').onchange = (e)=>{ state.filtros.estado = e.target.value.toLowerCase(); state.page=1; renderGrid(); };
  document.getElementById('f-tipo').oninput   = (e)=>{ state.filtros.tipo   = e.target.value; state.page=1; };
  document.getElementById('f-solo-activos').onchange = (e)=>{ state.filtros.soloActivos = e.target.checked; state.page=1; renderGrid(); };
  document.getElementById('btn-refrescar').onclick = ()=>{ state.page=1; renderGrid(); };
  document.getElementById('prev').onclick = ()=>{ state.page=Math.max(1, state.page-1); renderGrid(); };
  document.getElementById('next').onclick = ()=>{ state.page=state.page+1; renderGrid(); };
}

(async function start(){
  await ensureAuthUI();
  await renderSession();
  bindFilters();
  bindGridActions();
  await renderGrid();
})();
