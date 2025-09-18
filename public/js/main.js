import { supabase, whoami } from "./supabaseClient.js";
import { fetchEquipos, renderEquipos, initEquiposUI } from "./equipos.js";
// componentes.js es opcional por ahora; protegemos los imports dinámicamente si no existe.
// import { fetchComponentes, renderComponentes, initComponentesUI } from "./componentes.js";

/* ========== Utilidades UI ========== */
function $(s, r = document) { return r.querySelector(s); }
function $all(s, r = document) { return Array.from(r.querySelectorAll(s)); }

function flash(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, ms);
}

/* ========== Tabs ========== */
function initTabs() {
  const tabsWrap = $("#tabs");
  if (!tabsWrap) return; // evita null
  const btns = $all(".tab-btn", tabsWrap);
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      // activar botón
      btns.forEach(b => b.classList.toggle("active", b === btn));
      // activar panel
      $all(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${target}`));
      if (target === "equipos") {
        // recargar bajo demanda si tbody vació
        if (!$("#eq-tbody")?.children?.length) loadEquipos();
      } else if (target === "componentes") {
        // placeholder seguro
        if ($("#co-tbody")?.children?.length === 0) {
          $("#co-tbody").innerHTML = `Pendiente…`;
        }
      }
    });
  });
}

/* ========== Sesión / Header ========== */
async function initHeader() {
  const hdr = $("#hdr-session");
  const btnLogout = $("#btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        // logout suave (si auth.js no está, usamos supabase directo)
        if (supabase?.auth?.signOut) await supabase.auth.signOut();
        location.reload();
      } catch (e) {
        console.error(e);
        flash("No se pudo cerrar sesión");
      }
    });
  }
  try {
    // whoami() viene de supabaseClient.js; si no existe, mostramos placeholder
    const me = typeof whoami === "function" ? await whoami() : null;
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

/* ========== Equipos ========== */
async function loadEquipos() {
  const tbody = $("#eq-tbody");
  if (tbody) tbody.innerHTML = `Cargando…`;
  try {
    const data = await fetchEquipos();
    renderEquipos(data);
    // wire de acciones con función de recarga
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

/* ========== Bootstrap ========== */
async function init() {
  // Asegura que el DOM esté listo antes de enlazar listeners
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }
  // Inicializa header, tabs y contenido inicial
  await initHeader();
  initTabs();
  await loadEquipos();

  // Botones toolbar si existen
  $("#eq-crear")?.addEventListener("click", () => {}); // el wiring real vive en equipos.js
  $("#eq-refrescar")?.addEventListener("click", () => loadEquipos());
  $("#co-refrescar")?.addEventListener("click", () => {
    // placeholder seguro
    const tbody = $("#co-tbody");
    if (tbody) tbody.innerHTML = `Pendiente…`;
  });
}

init();
