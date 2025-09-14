// public/js/main.js
import { supabase } from "./supabaseClient.js";
import { getSessionProfile, fetchComponentes, bajaLogica, reportarFalla } from "./componentes.js";

let state = {
  page: 1,
  filtros: { estado: "", tipo: "", soloActivos: true },
  perfil: null,
};

const $ = (s) => document.querySelector(s);
const tbody = $("#tbody");
const pageEl = $("#page");
const prevBtn = $("#prev");
const nextBtn = $("#next");

function mapError(err) {
  const msg = err?.message?.toLowerCase() ?? "";
  if (msg.includes("rls") || err?.code === "42501") return "No tiene permisos para esta acción (RLS).";
  if (msg.includes("movimiento activo")) return "Movimiento activo: cierre/reciba antes de dar de baja.";
  if (msg.includes("montado")) return "Desensamble el componente antes de dar de baja.";
  if (msg.includes("detalle requerido")) return "Ingrese un detalle para la falla.";
  return "Error: " + (err?.message ?? "desconocido");
}

async function renderSession() {
  try {
    const profile = await getSessionProfile();
    state.perfil = profile?.profile ?? null;
    const el = document.getElementById("session-info");
    if (!profile) el.textContent = "No autenticado";
    else el.textContent = `${profile.user.email} • rol: ${state.perfil?.role ?? "—"}`;
  } catch (e) {
    console.error("[renderSession]", e);
  }
}

async function renderGrid() {
  try {
    const { page, filtros } = state;
    const res = await fetchComponentes({ page, ...filtros });
    tbody.innerHTML = res.rows
      .map((row) => {
        const canBaja = ["admin", "dev", "oficina"].includes(state.perfil?.role);
        const canFalla = state.perfil?.role === "centro" || ["admin", "dev", "oficina"].includes(state.perfil?.role);
        return `
          <tr>
            <td class="p-2">${row.serie ?? "—"}</td>
            <td class="p-2">${row.tipo_nombre ?? row.tipo_componente_id ?? "—"}</td>
            <td class="p-2">${row.estado_nombre ?? row.estado_componente_id ?? "—"}</td>
            <td class="p-2">${row.centro_nombre ?? "—"}</td>
            <td class="p-2">${row.is_active ? "Sí" : "No"}</td>
            <td class="p-2 flex gap-2">
              ${canBaja ? `<button data-act="baja" data-id="${row.id}" class="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500">Baja lógica</button>` : ""}
              ${canFalla ? `<button data-act="falla" data-id="${row.id}" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500">Reportar falla</button>` : ""}
            </td>
          </tr>
        `;
      })
      .join("");

    pageEl.textContent = `${res.page}/${res.pages}`;
    prevBtn.disabled = res.page <= 1;
    nextBtn.disabled = res.page >= res.pages;
  } catch (err) {
    console.error("[renderGrid]", err);
    alert(mapError(err));
    tbody.innerHTML = "";
    pageEl.textContent = "1/1";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
  }
}

async function bindAuthUI() {
  $("#btn-login")?.addEventListener("click", async () => {
    const email = $("#email").value;
    const pass = $("#pass").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) return alert("Login fallido: " + error.message);
    await renderSession();
    await renderGrid();
  });

  $("#btn-logout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    await renderSession();
    tbody.innerHTML = "";
  });
}

function bindGridActions() {
  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.act === "baja") {
      if (!confirm("¿Dar de baja lógica este componente?")) return;
      try {
        const res = await bajaLogica(id);
        if (res) await renderGrid();
      } catch (err) {
        alert(mapError(err));
      }
    }

    if (btn.dataset.act === "falla") {
      const detalle = prompt("Detalle de la falla:");
      if (!detalle) return;
      try {
        const res = await reportarFalla(id, detalle);
        if (res) alert("Falla reportada.");
      } catch (err) {
        alert(mapError(err));
      }
    }
  });
}

function bindFilters() {
  $("#f-estado").onchange = (e) => {
    state.filtros.estado = e.target.value.toLowerCase();
    state.page = 1;
    renderGrid();
  };
  $("#f-tipo").oninput = (e) => {
    state.filtros.tipo = e.target.value;
    state.page = 1;
  };
  $("#f-solo-activos").onchange = (e) => {
    state.filtros.soloActivos = e.target.checked;
    state.page = 1;
    renderGrid();
  };
  $("#btn-refrescar").onclick = () => {
    state.page = 1;
    renderGrid();
  };
  $("#prev").onclick = () => {
    state.page = Math.max(1, state.page - 1);
    renderGrid();
  };
  $("#next").onclick = () => {
    state.page = state.page + 1;
    renderGrid();
  };
}

(async function start() {
  // Diagnóstico inicial
  if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
    console.error("[ENV] Falta SUPABASE_URL o SUPABASE_ANON_KEY en env.js");
  }
  if (!window.supabase) {
    console.error("[CDN] No cargó @supabase/supabase-js");
  }

  await bindAuthUI();
  bindFilters();
  bindGridActions();
  await renderSession();
  await renderGrid();
})();
