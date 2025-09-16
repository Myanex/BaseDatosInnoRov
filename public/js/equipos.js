// public/js/equipos.js
// V3 — Día 3 · Parte 2 — Vista de Equipos + Modal “Reportar falla”
// Requiere: supabaseClient.js (client), auth.js (login/logout/estado)

(() => {
  // ------- Referencias DOM (existirán por index.html) -------
  const $viewLogin   = document.getElementById('view-login');
  const $viewApp     = document.getElementById('view-app');
  const $appHeader   = document.getElementById('appHeader');

  const $hdrEmail    = document.getElementById('hdrEmail');
  const $hdrRol      = document.getElementById('hdrRol');
  const $hdrCentro   = document.getElementById('hdrCentro');

  const $btnLogin    = document.getElementById('btnLogin');
  const $btnLogout   = document.getElementById('btnLogout');
  const $loginEmail  = document.getElementById('loginEmail');
  const $loginPass   = document.getElementById('loginPassword');
  const $loginMsg    = document.getElementById('loginMsg');

  // Equipos
  const $infoEq      = document.getElementById('equiposInfo');
  const $tblBody     = document.getElementById('tblEquiposBody');

  // Modal Reportar Falla
  const $modal       = document.getElementById('modalFallaEquipo');
  const $selComp     = document.getElementById('fallaEquipoComponente');
  const $txtDet      = document.getElementById('fallaEquipoDetalle');
  const $ttlModal    = document.getElementById('fallaEquipoTitulo');
  const $btnFallaOK  = document.getElementById('btnFallaEquipoEnviar');
  const $btnFallaNo  = document.getElementById('btnFallaEquipoCancelar');

  // ------- Estado simple -------
  let sessionProfile = null; // { email, role, centro_nombre, centro_id, ... }
  let equiposCache   = [];   // [{id,codigo,descripcion,ensamblados:[{id,serie}]}]
  let equipoCtx      = null; // {id,codigo}

  // ------- Helpers UI -------
  function showLogin() {
    $viewLogin?.classList.remove('hidden');
    $viewApp?.classList.add('hidden');
    $appHeader?.classList.add('hidden');
  }
  function showApp() {
    $viewLogin?.classList.add('hidden');
    $viewApp?.classList.remove('hidden');
    $appHeader?.classList.remove('hidden');
  }

  function setHeader(profile) {
    $hdrEmail.textContent  = profile?.email ?? '—';
    $hdrRol.textContent    = profile?.role ?? '—';
    $hdrCentro.textContent = profile?.centro_nombre ?? '—';
  }

  function rowHTML(e) {
    const compsCount = e.ensamblados?.length ?? 0;
    const compsText  = compsCount
      ? e.ensamblados.map(c => (c.serie ?? 'sin_serie')).join(', ')
      : '—';

    return `
      <tr>
        <td><strong>${e.codigo}</strong></td>
        <td>${e.descripcion ?? ''}</td>
        <td>${compsText}</td>
        <td>
          <div class="acciones">
            <button class="btn btn-secondary" data-acc="falla" data-id="${e.id}">Reportar falla</button>
          </div>
        </td>
      </tr>
    `;
  }

  function paintEquipos(list) {
    $tblBody.innerHTML = list.map(rowHTML).join('');
    // Delegación de eventos
    $tblBody.querySelectorAll('button[data-acc="falla"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const eq = equiposCache.find(x => x.id === id);
        if (eq) openModalFalla(eq);
      });
    });
  }

  // ------- Carga de datos -------
  async function loadProfile() {
    // Intento 1: si tu supabaseClient.js expone whoami() / fetchProfileAndCentro()
    try {
      if (typeof whoami === 'function') {
        const info = await whoami();
        if (info?.email) return info;
      }
    } catch (e) {
      console.warn('whoami() no disponible o falló', e);
    }
    // Intento 2: leer claims mínimas desde RLS con rpc_whoami si existe
    try {
      const { data, error } = await supabase.rpc('rpc_whoami');
      if (error) throw error;
      return data || {};
    } catch (e) {
      console.warn('rpc_whoami no disponible, se usará sesión auth básica');
      // Intento 3: usar usuario de auth
      const { data: { user } } = await supabase.auth.getUser();
      return { email: user?.email ?? null, role: null, centro_nombre: null, centro_id: null };
    }
  }

  async function loadEquipos() {
    // 1) Equipos visibles vía RLS
    const { data: eqs, error: errEq } = await supabase
      .from('equipos')
      .select('id,codigo,descripcion')
      .order('codigo', { ascending: true });

    if (errEq) {
      $infoEq.textContent = `Error cargando equipos: ${errEq.message}`;
      return [];
    }

    const ids = (eqs ?? []).map(x => x.id);
    if (ids.length === 0) return [];

    // 2) Vínculos vigentes de todos esos equipos
    const { data: vincs, error: errV } = await supabase
      .from('equipo_componente')
      .select('equipo_id, componente_id, fecha_fin')
      .in('equipo_id', ids)
      .is('fecha_fin', null);

    if (errV) {
      $infoEq.textContent = `Error vínculos: ${errV.message}`;
      return (eqs ?? []).map(e => ({...e, ensamblados: []}));
    }

    const compIds = [...new Set(vincs.map(v => v.componente_id))];
    let comps = [];
    if (compIds.length > 0) {
      const { data: cdata, error: errC } = await supabase
        .from('componentes')
        .select('id, serie')
        .in('id', compIds);

      if (errC) {
        $infoEq.textContent = `Error componentes: ${errC.message}`;
      } else {
        comps = cdata ?? [];
      }
    }

    // 3) Armar estructura
    const byEq = new Map();
    eqs.forEach(e => byEq.set(e.id, { ...e, ensamblados: [] }));
    vincs.forEach(v => {
      const rec = byEq.get(v.equipo_id);
      if (!rec) return;
      const c = comps.find(x => x.id === v.componente_id);
      rec.ensamblados.push({ id: v.componente_id, serie: c?.serie ?? null });
    });

    return Array.from(byEq.values());
  }

  // ------- Modal Reporte de Falla -------
  async function openModalFalla(eq) {
    equipoCtx = { id: eq.id, codigo: eq.codigo };
    $ttlModal.textContent = `Equipo: ${eq.codigo}`;
    $txtDet.value = '';

    // Cargar ensamblados vigentes del equipo
    const { data: vincs, error: errV } = await supabase
      .from('equipo_componente')
      .select('componente_id, fecha_fin')
      .eq('equipo_id', eq.id)
      .is('fecha_fin', null);

    if (errV) {
      alert('Error cargando componentes ensamblados: ' + errV.message);
      return;
    }
    if (!vincs || vincs.length === 0) {
      alert('Este equipo no tiene componentes ensamblados vigentes.');
      return;
    }

    const compIds = vincs.map(v => v.componente_id);
    const { data: comps, error: errC } = await supabase
      .from('componentes')
      .select('id, serie')
      .in('id', compIds);

    if (errC) {
      alert('Error cargando componentes: ' + errC.message);
      return;
    }

    $selComp.innerHTML = '';
    (comps ?? []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.serie ?? 'sin_serie'} • ${String(c.id).slice(0,8)}`;
      $selComp.appendChild(opt);
    });

    $modal.classList.remove('hidden');
    $modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    $modal.classList.add('hidden');
    $modal.setAttribute('aria-hidden', 'true');
    equipoCtx = null;
  }

  async function submitFalla() {
    if (!equipoCtx) return;
    const componenteId = $selComp.value;
    const detalle      = $txtDet.value?.trim() || '';

    const { data, error } = await supabase.rpc('rpc_equipo_reportar_falla', {
      p_equipo_id: equipoCtx.id,
      p_componente_id: componenteId,
      p_detalle: detalle
    });

    if (error) {
      alert('No se pudo reportar la falla: ' + (error.message || JSON.stringify(error)));
      return;
    }

    closeModal();
    alert('Falla registrada con id: ' + data);
    // Refrescar lista (opcional)
    await listarEquipos();
  }

  // ------- Login / Logout básicos (compatibles con auth.js) -------
  async function doLogin() {
    $loginMsg.textContent = 'Autenticando...';
    const email = $loginEmail.value?.trim();
    const pass  = $loginPass.value;
    if (!email || !pass) {
      $loginMsg.textContent = 'Completa email y contraseña';
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      $loginMsg.textContent = 'Error: ' + error.message;
      return;
    }
    $loginMsg.textContent = '';
    await onAuthChanged();
  }

  async function doLogout() {
    await supabase.auth.signOut();
    sessionProfile = null;
    equiposCache = [];
    showLogin();
  }

  async function onAuthChanged() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showLogin();
      return;
    }
    // Cargar perfil y datos
    sessionProfile = await loadProfile();
    setHeader(sessionProfile);
    showApp();
    await listarEquipos();
  }

  // ------- Carga inicial / wires -------
  async function listarEquipos() {
    $infoEq.textContent = 'Cargando...';
    equiposCache = await loadEquipos();
    paintEquipos(equiposCache);
    $infoEq.textContent = `Total: ${equiposCache.length} equipos`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Wires de auth
    $btnLogin?.addEventListener('click', doLogin);
    $btnLogout?.addEventListener('click', doLogout);
    $loginPass?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });

    // Wires modal
    $btnFallaOK?.addEventListener('click', submitFalla);
    $btnFallaNo?.addEventListener('click', closeModal);
    $modal?.addEventListener('click', (e) => {
      if (e.target === $modal) closeModal();
    });

    // Estado auth
    supabase.auth.onAuthStateChange((_event, _session) => { onAuthChanged().catch(console.error); });
    await onAuthChanged();
  });
})();

