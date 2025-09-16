// V3 – Día 3 · Parte 2
// Página "Equipos" + login básico + modal (dialog) para rpc_equipo_reportar_falla

// --- Supabase client debe existir globalmente (creado en supabaseClient.js) ---
/* global supabase */

(function () {
  // --------- DOM ---------
  const $viewAuth   = document.getElementById('view-auth');
  const $viewApp    = document.getElementById('view-app');
  const $badges     = document.getElementById('session-badges');
  const $btnLogout  = document.getElementById('btn-logout');

  const $email      = document.getElementById('auth-email');
  const $pass       = document.getElementById('auth-pass');
  const $btnLogin   = document.getElementById('btn-login');
  const $authMsg    = document.getElementById('auth-msg');

  const $tblBody    = document.getElementById('tbl-equipos-body');
  const $info       = document.getElementById('equipos-info');

  // Dialog (modal)
  const $dlg        = document.getElementById('dlg-falla-equipo');
  const $dlgTitle   = document.getElementById('dlg-falla-equipo-titulo');
  const $selComp    = document.getElementById('falla-comp');
  const $txtDet     = document.getElementById('falla-det');
  const $btnFallaOK = document.getElementById('btn-falla-send');
  const $btnFallaNo = document.getElementById('btn-falla-cancel');

  // --------- Estado ---------
  let sessionProfile = null; // { email, role, centro_id, centro_nombre }
  let equiposCache   = [];
  let equipoCtx      = null; // { id, codigo }

  // --------- Util ---------
  function showAuth() {
    $viewAuth.classList.add('active');
    $viewApp.classList.remove('active');
    $btnLogout.style.display = 'none';
    $badges.innerHTML = '';
  }
  function showApp() {
    $viewAuth.classList.remove('active');
    $viewApp.classList.add('active');
    $btnLogout.style.display = '';
  }
  function setBadges(p) {
    const email  = p?.email ?? '—';
    const role   = p?.role ?? '—';
    const centro = p?.centro_nombre ?? '—';
    $badges.innerHTML = `
      <span class="pill">${email}</span>
      <span class="pill">Rol: ${role}</span>
      <span class="pill">Centro: ${centro}</span>
    `;
  }

  async function whoamiFallback() {
    // 1) Si existe RPC whoami()
    try {
      const { data, error } = await supabase.rpc('rpc_whoami');
      if (!error && data) return data;
    } catch {}
    // 2) claims básicas desde auth
    const { data: { user } } = await supabase.auth.getUser();
    return { email: user?.email ?? null, role: null, centro_id: null, centro_nombre: null };
  }

  // --------- Auth ---------
  async function doLogin() {
    $authMsg.textContent = 'Autenticando...';
    const email = $email.value?.trim();
    const pass  = $pass.value;
    if (!email || !pass) {
      $authMsg.textContent = 'Completa email y contraseña';
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      $authMsg.textContent = 'Error: ' + error.message;
      return;
    }
    $authMsg.textContent = '';
    await onAuthChanged();
  }

  async function doLogout() {
    await supabase.auth.signOut();
    sessionProfile = null;
    equiposCache = [];
    showAuth();
  }

  async function onAuthChanged() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showAuth();
      return;
    }
    sessionProfile = await whoamiFallback();
    setBadges(sessionProfile);
    showApp();
    await listarEquipos();
  }

  // --------- Datos ---------
  function rowHTML(e) {
    const comps = e.ensamblados?.length
      ? e.ensamblados.map(c => (c.serie ?? 'sin_serie')).join(', ')
      : '—';
    return `
      <tr>
        <td><strong>${e.codigo}</strong></td>
        <td>${e.descripcion ?? ''}</td>
        <td>${comps}</td>
        <td>
          <div class="actions">
            <button class="small" data-acc="falla" data-id="${e.id}">Reportar falla</button>
          </div>
        </td>
      </tr>
    `;
  }

  function paintEquipos(list) {
    $tblBody.innerHTML = list.map(rowHTML).join('');
    $tblBody.querySelectorAll('button[data-acc="falla"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const eq = equiposCache.find(x => x.id === id);
        if (eq) openFalla(eq);
      });
    });
  }

  async function loadEquipos() {
    // Equipos visibles por RLS
    const { data: eqs, error: errEq } = await supabase
      .from('equipos')
      .select('id,codigo,descripcion')
      .order('codigo', { ascending: true });

    if (errEq) {
      $info.textContent = `Error cargando equipos: ${errEq.message}`;
      return [];
    }
    const ids = (eqs ?? []).map(x => x.id);
    if (ids.length === 0) return [];

    // Vínculos vigentes
    const { data: vincs, error: errV } = await supabase
      .from('equipo_componente')
      .select('equipo_id, componente_id, fecha_fin')
      .in('equipo_id', ids)
      .is('fecha_fin', null);

    if (errV) {
      $info.textContent = `Error vínculos: ${errV.message}`;
      return (eqs ?? []).map(e => ({ ...e, ensamblados: [] }));
    }

    const compIds = [...new Set(vincs.map(v => v.componente_id))];
    let comps = [];
    if (compIds.length > 0) {
      const { data: cdata, error: errC } = await supabase
        .from('componentes')
        .select('id, serie')
        .in('id', compIds);
      if (!errC && cdata) comps = cdata;
    }

    const byEq = new Map();
    (eqs ?? []).forEach(e => byEq.set(e.id, { ...e, ensamblados: [] }));
    (vincs ?? []).forEach(v => {
      const rec = byEq.get(v.equipo_id);
      if (!rec) return;
      const c = comps.find(x => x.id === v.componente_id);
      rec.ensamblados.push({ id: v.componente_id, serie: c?.serie ?? null });
    });

    return Array.from(byEq.values());
  }

  async function listarEquipos() {
    $info.textContent = 'Cargando...';
    equiposCache = await loadEquipos();
    paintEquipos(equiposCache);
    $info.textContent = `Total: ${equiposCache.length} equipos`;
  }

  // --------- Modal Falla ---------
  async function openFalla(eq) {
    equipoCtx = { id: eq.id, codigo: eq.codigo };
    $dlgTitle.textContent = `Equipo: ${eq.codigo}`;
    $txtDet.value = '';

    const { data: vincs, error: errV } = await supabase
      .from('equipo_componente')
      .select('componente_id, fecha_fin')
      .eq('equipo_id', eq.id)
      .is('fecha_fin', null);

    if (errV) { alert('Error cargando componentes: ' + errV.message); return; }
    if (!vincs || vincs.length === 0) { alert('Sin componentes ensamblados.'); return; }

    const compIds = vincs.map(v => v.componente_id);
    const { data: comps, error: errC } = await supabase
      .from('componentes')
      .select('id, serie')
      .in('id', compIds);
    if (errC) { alert('Error cargando componentes: ' + errC.message); return; }

    $selComp.innerHTML = '';
    (comps ?? []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.serie ?? 'sin_serie'} • ${String(c.id).slice(0,8)}`;
      $selComp.appendChild(opt);
    });

    try { $dlg.showModal(); } catch { $dlg.setAttribute('open',''); }
  }

  async function submitFalla(ev) {
    // Evitar que <form method="dialog"> cierre antes de llamar RPC
    if (ev) ev.preventDefault();
    if (!equipoCtx) return;

    const componenteId = $selComp.value;
    const detalle      = $txtDet.value?.trim() || '';

    const { data, error } = await supabase.rpc('rpc_equipo_reportar_falla', {
      p_equipo_id: equipoCtx.id,
      p_componente_id: componenteId,
      p_detalle: detalle
    });

    if (error) { alert('No se pudo reportar la falla: ' + (error.message || JSON.stringify(error))); return; }

    // Cerrar y refrescar
    try { $dlg.close(); } catch { $dlg.removeAttribute('open'); }
    equipoCtx = null;
    alert('Falla registrada con id: ' + data);
    await listarEquipos();
  }

  function cancelFalla() {
    try { $dlg.close(); } catch { $dlg.removeAttribute('open'); }
    equipoCtx = null;
  }

  // --------- Wires iniciales ---------
  document.addEventListener('DOMContentLoaded', async () => {
    $btnLogin?.addEventListener('click', doLogin);
    $authMsg.textContent = '';
    $pass?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $btnLogout?.addEventListener('click', doLogout);

    $btnFallaOK?.addEventListener('click', submitFalla);
    $btnFallaNo?.addEventListener('click', (e) => { e.preventDefault(); cancelFalla(); });

    supabase.auth.onAuthStateChange((_event, _session) => { onAuthChanged().catch(console.error); });
    await onAuthChanged();
  });
})();


