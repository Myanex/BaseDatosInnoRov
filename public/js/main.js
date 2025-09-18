import { supabase, whoami } from "./supabaseClient.js";
import { checkSession, logout } from "./auth.js";
import { fetchEquipos, renderEquipos, initEquiposUI } from "./equipos.js";
import { fetchComponentes, renderComponentes, initComponentesUI } from "./componentes.js";

/* ========== Helpers ========== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function flash(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) return console.log(msg);
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, ms);
}

/* ========== Header / Sesión ========== */
async function initHeader() {
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
  // Logout
  $("#btn-logout")?.addEventListener("click", async () => {
    try {
      await logout();
    } catch (e) {
      // fallback directo si no existe logout o falla
      try { await supabase?.auth?.signOut?.(); } catch {}
    } finally {
      // volver a la página raíz (login)
      location.href = "/";
    }
  });
}

/* ========== Tabs ========== */
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

/* ========== Equipos ========== */
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

/* ========== Componentes ========== */
async function loadComponentes() {
  const tbody = $("#co-tbody");
  if (tbody) tbody.innerHTML = `Cargando…`;
  try {
    const data = await fetchComponentes();
    renderComponentes(data);
    initComponentesUI(async () => {
      const refreshed = await fetchComponentes();
      renderComponentes(refreshed);
      flash("Actualizado");
    });
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML = `Error al cargar`;
    flash("Error al cargar componentes");
  }
}

/* ========== Bootstrap ========== */
async function init() {
  // Esperar DOM listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }

  // Verificar sesión con el módulo existente
  try {
    await checkSession(); // asume redirect interno si no hay sesión
  } catch (e) {
    // Si checkSession no hace redirect, hacemos un fallback simple
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      location.href = "/";
      return;
    }
  }

  await initHeader();
  initTabs();

  // Cargar tab activa por defecto (Equipos)
  await loadEquipos();

  // Wire toolbar sin romper si no existen
  $("#eq-refrescar")?.addEventListener("click", () => loadEquipos());
  $("#co-refrescar")?.addEventListener("click", () => loadComponentes());
}

init();
