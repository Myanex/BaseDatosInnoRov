import { supabase, whoami, fetchProfileAndCentro } from "./supabaseClient.js";
import { checkSession, login, logout } from "./auth.js";
import { fetchEquipos, renderEquipos } from "./equipos.js";
import { fetchComponentes, renderComponentes } from "./componentes.js";

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

  if (!me) {
    sessionInfo.textContent = "";
    btnLogout.style.display = "none";
    return;
  }

  const info = await fetchProfileAndCentro(me.user_id, me.centro_id);

  sessionInfo.innerHTML = `
    <span class="pill">Usuario: <strong>${info.email ?? "—"}</strong></span>
    <span class="pill">Rol: <strong>${info.role ?? me.role ?? "—"}</strong></span>
    <span class="pill">Centro: <strong>${info.centro_nombre ?? "—"}</strong></span>
  `;
  btnLogout.style.display = "inline-block";
}

async function init() {
  // Login form
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

  // Header logout
  document.querySelector("#btn-logout").onclick = logout;

  // Tabs
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      switchTab(btn.dataset.tab);
      if(btn.dataset.tab==="equipos") await loadEquipos();
      if(btn.dataset.tab==="componentes") await loadComponentes();
    });
  });

  // Refrescar
  document.querySelector("#eq-refrescar").onclick = loadEquipos;
  document.querySelector("#co-refrescar").onclick = loadComponentes;

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

