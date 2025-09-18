import { supabase, whoami } from "./supabaseClient.js";
import { checkSession, logout } from "./auth.js";
import { fetchEquipos, renderEquipos, initEquiposUI } from "./equipos.js";
import { fetchComponentes, renderComponentes, initComponentesUI } from "./componentes.js";

/* ========== Single init guard ========== */
if (window.__ROV_MAIN_INITED__) {
  console.warn("main.js ya inicializado — omitiendo segunda carga.");
} else {
  window.__ROV_MAIN_INITED__ = true;

  /* ========== Helpers ========== */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function flash(msg, ms = 1800) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.style.display = "none"; }, ms);
  }

  function bindOnce(el, ev, fn) {
    if (!el) return;
    const key = `__wired_${ev}`;
    if (el[key]) return;
    el.addEventListener(ev, fn);
    el[key] = true;
  }

  /* ========== Header / Sesión (sin redirecciones automáticas) ========== */
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
    // Logout sólo cuando el usuario lo pide
    bindOnce($("#btn-logout"), "click", async () => {
      try { await logout?.(); } catch {}
      try { await supabase?.auth?.signOut?.(); } catch {}
      // Limpia tokens locales por si quedan restos
      try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("sb-") && (k.endsWith("-auth-token") || k.endsWith("-persist"))) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
      } catch {}
      try { sessionStorage.clear(); } catch {}
      // Redirigir a la raíz una sola vez
      location.href = "/";
    });
  }

  /* ========== Tabs ========== */
  function initTabs() {
    const tabsWrap = $("#tabs");
    if (!tabsWrap) return;
    const btns = $$(".tab-btn", tabsWrap);
    btns.forEach(btn => {
      bindOnce(btn, "click", () => {
        const target = btn.dataset.tab;
        btns.forEach(b => b.classList.toggle("active", b === btn));
        $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${target}`));
        if (target === "equipos") {
          loadEquipos(true);
        } else if (target === "componentes") {
          loadComponentes(true);
        }
      });
    });
  }

  /* ========== Equipos (debounced) ========== */
  let equiposInFlight = false;
  async function loadEquipos(fromTab = false) {
    if (equiposInFlight) return;
    equiposInFlight = true;
    const tbody = $("#eq-tbody");
    if (tbody && !fromTab) {
      tbody.innerHTML = `Cargando…`;
    }
    try {
      const data = await fetchEquipos();
      renderEquipos(data);
      initEquiposUI(async () => {
        if (equiposInFlight) return;
        const refreshed = await fetchEquipos();
        renderEquipos(refreshed);
        flash("Actualizado");
      });
    } catch (e) {
      console.error(e);
      if (tbody) tbody.innerHTML = `Error al cargar`;
      flash("Error al cargar equipos");
    } finally {
      equiposInFlight = false;
    }
  }

  /* ========== Componentes (debounced, single-wire) ========== */
  let componentesLoadedOnce = false;
  let componentesInFlight = false;
  async function loadComponentes(fromTab = false) {
    if (componentesInFlight) return;
    componentesInFlight = true;
    const tbody = $("#co-tbody");
    if (tbody && (!componentesLoadedOnce || !fromTab)) {
      tbody.innerHTML = `Cargando…`;
    }
    try {
      const data = await fetchComponentes();
      renderComponentes(data);
      if (!componentesLoadedOnce) {
        initComponentesUI(async () => {
          if (componentesInFlight) return;
          const refreshed = await fetchComponentes();
          renderComponentes(refreshed);
          flash("Actualizado");
        });
        componentesLoadedOnce = true;
      }
    } catch (e) {
      console.error(e);
      if (tbody) tbody.innerHTML = `Error al cargar`;
      flash("Error al cargar componentes");
    } finally {
      componentesInFlight = false;
    }
  }

  /* ========== Bootstrap ========== */
  async function start() {
    await initHeader();
    initTabs();
    // Wire toolbar una sola vez
    bindOnce($("#eq-refrescar"), "click", () => loadEquipos());
    bindOnce($("#co-refrescar"), "click", () => loadComponentes());
    // Carga inicial
    await loadEquipos();
  }

  async function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }
    // Validación de sesión sin redirigir ni recargar
    try { await checkSession(); } catch {}
    await start();
  }

  init();
}
