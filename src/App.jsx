import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    (async () => {
      if (!session) return setProfile(null)
      const { data } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle()
      setProfile(data ?? null)
    })()
  }, [session])

  const login = async () => {
    setMsg('')
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMsg(error.message)
  }

  const logout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: 24 }}>
      <h1>Sistema ROV — v2</h1>

      {!session && (
        <div style={{ border:'1px solid #ddd', borderRadius:12, padding:16, maxWidth:720 }}>
          <h2>Iniciar sesión</h2>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
            <input id="email" type="email" placeholder="email" />
            <input id="password" type="password" placeholder="contraseña" />
            <button onClick={login}>Entrar</button>
          </div>
          <p style={{ color:'#b00020' }}>{msg}</p>
        </div>
      )}

      {session && (
        <div style={{ border:'1px solid #ddd', borderRadius:12, padding:16, maxWidth:720 }}>
          <h2>Panel</h2>
          <p>Hola {profile?.nombre || '(cargando...)'}</p>
          <button onClick={logout}>Cerrar sesión</button>
        </div>
      )}
    </main>
  )
}
