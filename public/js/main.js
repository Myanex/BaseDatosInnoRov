import { supabase, whoami } from "./supabaseClient.js";
import { fetchEquipos, renderEquipos, initEquiposUI } from "./equipos.js";

/* ===================== Helpers UI ===================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function flash(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, ms);
}

function toggleApp(visible) {
  const app   = $("#tab-equipos")?.closest("main") || document.body; // fallback
  const login = $("#login-dyn");
  if (visible) {
    if (app) app.style.display = "";
    if (login) login.remove();
  } else {
    if (app) app.style.display = "none";
    if (!login) renderLoginOverlay();
  }
}

/* ===================== Login Overlay (dinámico) ===================== */
function renderLoginOverlay() {
  const existing = $("#login-dyn");
  if (existing) return;
  const wrap = document.createElement("div");
  wrap.id = "login-dyn";
  wrap.innerHTML = `
    
    

      
Iniciar sesión

      
Email
        

      
Contraseña
        

      
Entrar

      
Usa tus credenciales de Supabase Auth.


    

  `;
  document.body.appendChild(wrap);
  $("#btn-login")?.addEventListener("click", async () => {
    const email = $("#login-email")?.value?.trim();
    const pass  = $("#login-pass")?.value ?? "";
    if (!email || !pass) { flash("Completa email y contraseña"); return; }
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      location.reload();
    } catch (e) {
      $("#login-msg").textContent = e?.message || "No se pudo iniciar sesión";
    }
  });
}

/* ===================== Tabs ===================== */
function initTabs() {
  const tabsWrap = $("#tabs");
  if (!tabsWrap) return;
  const btns = $$(".tab-btn", tabsWrap);
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      btns.forEach(b => b.classList.toggle("active", b === btn));
      $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${target}`));
      if (target === "equipos") {
        if (!$("#eq-tbody")?.children?.length) loadEquipos();
      } else if (target === "componentes") {
        const tbody = $("#co-tbody");
        if (tbody && !tbody.dataset.filled) {
          tbody.innerHTML = `Pendiente…`;
          tbody.dataset.filled = "1";
        }
      }
    });
  });
}

/* ===================== Header / Sesión ===================== */
async function updateHeader() {
  const hdr = $("#hdr-session");
  try {
    const me = await whoami().catch(() => null);
    if (hdr && me) {
      const role = me?.role ?? "—";
      const email = me?.email ?? "—";
      const centro = me?.centro_nombre ?? "—";
      hdr.textContent = `${email} · Rol: ${role} · Centro: ${centro}`;
    } else if (hdr) {
      hdr.textContent = "—";
    }
  } catch {
    if (hdr) hdr.textContent = "—";
  }
}

function initLogout() {
  $("#btn-logout")?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      // Mostrar login y limpiar UI
      toggleApp(false);
      location.reload();
    }
  });
}

/* ===================== Equipos ===================== */
async function loadEquipos() {
  const tbody = $("#eq-tbody");
  if (tbody) tbody.innerHTML = `Cargando…`;
  try {
    const data = await fetchEquipos();
    renderEquipos(data);
    initEquiposUI(async () => {
      const refreshed = await fetchEquipos();
      renderEquipos(refreshed);
      flash("Actualizado");
    });
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML = `Error al cargar`;
    flash("Error al cargar equipos");
  }
}

/* ===================== Bootstrap ===================== */
async function startApp() {
  initTabs();
  initLogout();
  await updateHeader();
  await loadEquipos();
}

async function init() {
  // Esperar DOM listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }
  // Ver estado de sesión
  const { data } = await supabase.auth.getSession();
  const hasSession = !!data?.session;
  toggleApp(hasSession);
  if (hasSession) {
    await startApp();
  } else {
    // escuchar cambios para login
    supabase.auth.onAuthStateChange((ev, sess) => {
      if (sess) location.reload();
    });
  }
}

init();
