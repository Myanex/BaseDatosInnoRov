import { supabase, whoami, fetchProfileAndCentro } from "./supabaseClient.js";
import { checkSession, logout } from "./auth.js";
import { fetchEquipos, renderEquipos, initEquiposUI } from "./equipos.js";
import { fetchComponentes, renderComponentes, initComponentesUI } from "./componentes.js";

/* ===== Simple helpers ===== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function flash(msg, ms = 2000) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.display = "none"; }, ms);
}

/* ===== Header / sesión ===== */
async function initHeader() {
  const hdr = $("#hdr-session");
  try {
    const me = await whoami().catch(() => null);
    let extra = null;
    if (me) {
      try {
        extra = await fetchProfileAndCentro(me.user_id, me.centro_id);
      } catch (err) {
        console.error(err);
      }
    }

    let merged = null;
    if (me || extra) {
      merged = { ...(me ?? {}), ...(extra ?? {}) };
      if (me?.role !== undefined) {
        merged.role = me.role;
      }
    }

    if (hdr && merged) {
      const role = me?.role ?? merged?.role ?? "—";
      const email = merged?.email ?? me?.email ?? "—";
      const centro = merged?.centro_nombre ?? me?.centro_nombre ?? "—";
      hdr.textContent = `${email} · Rol: ${role} · Centro: ${centro}`;
    } else if (hdr) {
      hdr.textContent = "—";
    }
  } catch {
    if (hdr) hdr.textContent = "—";
  }

  // Salir
  $("#btn-logout")?.addEventListener("click", async () => {
    try { await logout?.(); } catch {}
    try { await supabase?.auth?.signOut?.(); } catch {}
    // Limpieza local defensiva y volver al inicio
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-") && (k.endsWith("-auth-token") || k.endsWith("-persist"))) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    } catch {}
    try { sessionStorage.clear(); } catch {}
    location.href = "/";
  });
}

/* ===== Tabs ===== */
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
        loadEquipos();
      } else if (target === "componentes") {
        loadComponentes();
      }
    });
  });
}

/* ===== Equipos ===== */
async function loadEquipos({ flash: showFlash = false } = {}) {
  const tbody = $("#eq-tbody");
  if (tbody) tbody.innerHTML = `Cargando…`;
  try {
    const data = await fetchEquipos();
    renderEquipos(data);
    if (showFlash) flash("Actualizado");
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML = `Error al cargar`;
    flash("Error al cargar equipos");
  }
}

/* ===== Componentes ===== */
async function loadComponentes({ flash: showFlash = false } = {}) {
  const tbody = $("#co-tbody");
  if (tbody) tbody.innerHTML = `Cargando…`;
  try {
    const data = await fetchComponentes();
    renderComponentes(data);
    if (showFlash) flash("Actualizado");
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML = `Error al cargar`;
    flash("Error al cargar componentes");
  }
}

/* ===== Bootstrap ===== */
async function init() {
  // Asegurar DOM listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }

  // Respetar tu flujo actual de auth
  try { await checkSession?.(); } catch {}

  await initHeader();
  initTabs();

  const requestEquiposReload = () => loadEquipos({ flash: true });
  const requestComponentesReload = () => loadComponentes({ flash: true });

  initEquiposUI(requestEquiposReload);
  initComponentesUI(requestComponentesReload);

  // Tab por defecto
  await loadEquipos();
}

// Evitar doble init si el bundle carga dos veces por error
if (!window.__ROV_MAIN_INITED__) {
  window.__ROV_MAIN_INITED__ = true;
  init();
} else {
  console.warn("main.js ya estaba inicializado");
}
