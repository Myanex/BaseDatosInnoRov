import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Catalogos from './Catalogos.jsx'
import EmpresasCentros from './EmpresasCentros.jsx'
import UsuariosAdmin from './UsuariosAdmin.jsx'
import ReportesBitacora from './ReportesBitacora.jsx'

// estilos simples
const btn  = { padding: '8px 12px', border: '1px solid #bbb', borderRadius: 8, cursor: 'pointer' }
const card = { border: '1px solid #ddd', borderRadius: 12, padding: 16, maxWidth: 960 }
const row  = { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loginMsg, setLoginMsg] = useState('')
  const [changeMsg, setChangeMsg] = useState('')
  const [view, setView] = useState('panel') // panel | catalogos | empresas | usuarios

  // --- Sesión ---
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // --- Cargar profile cuando haya sesión ---
  useEffect(() => {
    (async () => {
      if (!session) {
        setProfile(null)
        return
      }
      const uid = session.user.id
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle()
      if (error) {
        console.error('profiles error:', error.message)
        setProfile(null)
      } else {
        setProfile(data ?? null)
      }
    })()
  }, [session])

  // --- Acciones ---
  const doLogin = async () => {
    setLoginMsg('')
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setLoginMsg(error.message)
  }

  const doLogout = async () => {
    await supabase.auth.signOut()
    setView('panel')
  }

  const doChangePass = async () => {
    setChangeMsg('')
    const p1 = document.getElementById('newPass').value
    const p2 = document.getElementById('newPass2').value

    if (p1.length < 6) return setChangeMsg('Debe tener al menos 6 caracteres.')
    if (p1 !== p2) return setChangeMsg('No coinciden.')

    // Evitar RUT como nueva clave
    if (profile?.rut && String(profile.rut) === p1) {
      return setChangeMsg('La nueva contraseña no puede ser igual a tu RUT.')
    }

    const { error: e1 } = await supabase.auth.updateUser({ password: p1 })
    if (e1) return setChangeMsg(e1.message)

    const { error: e2 } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('user_id', profile.user_id)

    if (e2) return setChangeMsg(e2.message)

    setChangeMsg('Contraseña actualizada. ✅')
  }

  // --- Flags de vista ---
  const needLogin    = !session
  const needFirstRun = session && profile?.must_change_password
  const readyPanel   = session && profile && !profile.must_change_password
  const isAdmin      = profile?.rol === 'admin'

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial', margin: 24 }}>
      <h1>Sistema ROV — v2</h1>

      {/* Login */}
      {needLogin && (
        <div style={{ ...card, maxWidth: 720 }}>
          <h2>Iniciar sesión</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <input id="email" type="email" placeholder="email" />
            <input id="password" type="password" placeholder="contraseña" />
            <button onClick={doLogin} style={btn}>Entrar</button>
          </div>
          <p style={{ color: '#b00020' }}>{loginMsg}</p>
        </div>
      )}

      {/* Primer inicio: cambio de contraseña */}
      {needFirstRun && (
        <div style={{ ...card, maxWidth: 720 }}>
          <h2>Primer inicio — Cambiar contraseña</h2>
          <p>Debe ser distinta a tu RUT (cuerpo sin DV) y tener al menos 6 caracteres.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <input id="newPass" type="password" placeholder="nueva contraseña" />
            <input id="newPass2" type="password" placeholder="repetir contraseña" />
            <button onClick={doChangePass} style={btn}>Cambiar</button>
          </div>
          <p>{changeMsg}</p>
        </div>
      )}

      {/* Panel + navegación */}
      {readyPanel && (
        <div style={card}>
          <h2>Panel</h2>
          <p>Hola <b>{profile?.nombre}</b> — rol: <b>{profile?.rol}</b></p>

          <div style={row}>
            <button
              style={{ ...btn, background: view === 'panel' ? '#f5f5f5' : 'white' }}
              onClick={() => setView('panel')}
            >
              Panel
            </button>

            {isAdmin && (
              <>
                <button
                  style={{ ...btn, background: view === 'catalogos' ? '#f5f5f5' : 'white' }}
                  onClick={() => setView('catalogos')}
                >
                  Catálogos
                </button>

                <button
                  style={{ ...btn, background: view === 'empresas' ? '#f5f5f5' : 'white' }}
                  onClick={() => setView('empresas')}
                >
                  Empresas/Centros
                </button>

                <button
                  style={{ ...btn, background: view === 'usuarios' ? '#f5f5f5' : 'white' }}
                  onClick={() => setView('usuarios')}
                >
                  Usuarios
                </button>
                <button
                  style={{ ...btn, background: view === 'reportes' ? '#f5f5f5' : 'white' }}
                  onClick={() => setView('reportes')}
                  >
                  Reportes
                </button>
              </>
            )}

            <div style={{ flex: 1 }} />
            <button onClick={doLogout} style={btn}>Cerrar sesión</button>
          </div>

          {/* Contenido por vista */}
          {view === 'panel' && (
            <div>
              <p>Bienvenido. Empieza por <b>Catálogos</b>, luego crea <b>Empresas/Centros</b> y finalmente <b>Usuarios</b>.</p>
            </div>
          )}

          {view === 'catalogos' && isAdmin && (
            <Catalogos profile={profile} />
          )}

          {view === 'empresas' && isAdmin && (
            <EmpresasCentros profile={profile} />
          )}

          {view === 'usuarios' && isAdmin && (
            <UsuariosAdmin />
          )}

          {view === 'reportes' && isAdmin && 
            <ReportesBitacora />}
        </div>
      )}
    </main>
  )
}


   

