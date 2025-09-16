import { supabase, whoami } from "./supabaseClient.js";

export async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    document.querySelector("#view-auth").classList.remove("active");
    document.querySelector("#view-app").classList.add("active");
    return await whoami();
  } else {
    document.querySelector("#view-auth").classList.add("active");
    document.querySelector("#view-app").classList.remove("active");
    return null;
  }
}

export async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return await checkSession();
}

export async function logout() {
  await supabase.auth.signOut();
  location.reload();
}

