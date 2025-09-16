import { whoami } from "./supabaseClient.js";
import { checkSession, login, logout } from "./auth.js";
import { fetchEquipos, renderEquipos, initEquiposUI } from "./equipos.js";
import { fetchComponentes, renderComponentes, initComponentesUI } from "./componentes.js";

function switchTab(tab) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll("#view-app .panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  document.querySelector(`#panel-${tab}`).classList.add("active");
}

async function renderHeaderSession() {
  const me = await whoami();
  const sessionInfo = document.querySelector("#session-info");
  const btnLogout = document.querySelector("#btn-logout");
  if (!me) { sessionInfo.textContent = ""; btnLogout.style.display="none"; return; }

  // email/rol/centro nombre desde perfiles + centros (ya lo resolvimos en archivos previos)
  const prof = await (await import("./supabaseClient.js")).fetchProfileAndCentro(me.user_id, me.centro_id);
  sessionInfo.innerHTML = `
    <span class="pill">Usuario: <strong>${prof.email ?? "—"}</strong></span>
    <span class="pill">Rol: <strong>${prof.role ?? me.role ?? "—"}</strong></span>
    <span class="pill">Centro: <strong>${prof.centro_nombre ?? "—"}</strong></span>
  `;
  btnLogout.style.display="inline-block";
}

async function init() {
  // Login
  document.querySelector("#form-login").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const email = document.querySelector("#email").value.trim();
    const pass  = document.querySelector("#password").value;
    try {
      await login(email, pass);
      await renderHeaderSession();
      await loadEquipos(); // default
    } catch(err) {
      document.querySelector("#auth-alerts").textContent = err.message;
    }
  });

  document.querySelector("#btn-logout").onclick = logout;

  // Tabs
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      switchTab(btn.dataset.tab);
      if(btn.dataset.tab==="equipos") await loadEquipos();
      if(btn.dataset.tab==="componentes") await loadComponentes();
    });
  });

  // Inicializar listeners por pestaña (botones, modales)
  initEquiposUI(loadEquipos);
  initComponentesUI(loadComponentes);

  // Arranque
  const me = await checkSession();
  if (me) {
    await renderHeaderSession();
    await loadEquipos();
  }
}

async function loadEquipos(){
  const data = await fetchEquipos();
  renderEquipos(data);
}

async function loadComponentes(){
  const data = await fetchComponentes();
  renderComponentes(data);
}

init();

