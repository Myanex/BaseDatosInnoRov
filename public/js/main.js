import { supabase } from "./supabaseClient.js";
import { checkSession, login, logout } from "./auth.js";
import { fetchEquipos, renderEquipos } from "./equipos.js";
import { fetchComponentes, renderComponentes } from "./componentes.js";

function switchTab(tab) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  document.querySelector(`#panel-${tab}`).classList.add("active");
}

async function init() {
  // Login form
  document.querySelector("#form-login").addEventListener("submit", async ev=>{
    ev.preventDefault();
    const email = document.querySelector("#email").value;
    const pass  = document.querySelector("#password").value;
    try {
      await login(email, pass);
      await loadEquipos();
    } catch(err) {
      document.querySelector("#auth-alerts").textContent = err.message;
    }
  });

  document.querySelector("#btn-logout").onclick = logout;

  // Tabs
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      switchTab(btn.dataset.tab);
      if(btn.dataset.tab==="equipos") loadEquipos();
      if(btn.dataset.tab==="componentes") loadComponentes();
    });
  });

  // Refrescar
  document.querySelector("#eq-refrescar").onclick = loadEquipos;
  document.querySelector("#co-refrescar").onclick = loadComponentes;

  await checkSession();
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

