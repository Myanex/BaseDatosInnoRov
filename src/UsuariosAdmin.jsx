import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from './supabaseClient'

const box = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:1200 }
const row = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const input = { padding:8, border:'1px solid #bbb', borderRadius:8 }
const tbl = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 6px', textAlign:'left' }
const chip = (ok) => ({ padding:'2px 8px', borderRadius:999, background: ok ? '#e6f6ed' : '#fde8e8', border:'1px solid #cfe9dc', fontSize:12 })

export default function UsuariosAdmin() {
  // Mensajes
  const [createMsg, setCreateMsg] = useState('')
  const [trMsg, setTrMsg] = useState('')
  const [listMsg, setListMsg] = useState('')

  // Catálogos (transferencia)
  const [empresas, setEmpresas] = useState([])
  const [zonas, setZonas] = useState([])
  const [centros, setCentros] = useState([])

  // Crear usuario
  const [rolSel, setRolSel] = useState('centro')
  const [asignarCentro, setAsignarCentro] = useState(false)
  const [empresaSel, setEmpresaSel] = useState('')
  const [zonaSel, setZonaSel] = useState('')
  const [centroSel, setCentroSel] = useState('')

  // Usuarios
  const [usuarios, setUsuarios] = useState([])
  const [qUser, setQUser] = useState('')
  const [userSel, setUserSel] = useState('') // para transferencia
  const [rolDraft, setRolDraft] = useState({}) // user_id -> rol seleccionado
  const [rowMsg, setRowMsg] = useState({})     // user_id -> msg por fila

  // ===== cargas =====
  const loadEmpresas = async () => {
    const { data } = await supabase.from('empresas').select('id, nombre').order('nombre')
    setEmpresas(data || [])
  }
  const loadZonas = async (empresaId) => {
    const { data } = await supabase.from('zonas').select('id, nombre').eq('empresa_id', empresaId).order('nombre')
    setZonas(data || [])
  }
  const loadCentros = async (zonaId) => {
    const { data } = await supabase.from('centros').select('id, nombre').eq('zona_id', zonaId).order('nombre')
    setCentros(data || [])
  }

  const loadUsuarios = async () => {
    setListMsg('')
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, nombre, correo, rut, rol, is_active, must_change_password')
      .order('rol', { ascending: true })
      .order('nombre', { ascending: true })
    if (error) setListMsg('❌ ' + error.message)
    setUsuarios(data || [])
    const d = {}
    ;(data || []).forEach(u => { d[u.user_id] = u.rol })
    setRolDraft(d)
  }
  useEffect(() => { loadUsuarios() }, [])

  // combos crear (solo si corresponde)
  useEffect(() => {
    if (rolSel !== 'centro') {
      setAsignarCentro(false)
      setEmpresaSel(''); setZonaSel(''); setCentroSel('')
      setEmpresas([]); setZonas([]); setCentros([])
    }
  }, [rolSel])

  useEffect(() => { (async () => {
    if (rolSel === 'centro' && asignarCentro) {
      await loadEmpresas()
      setEmpresaSel(''); setZonaSel(''); setCentroSel('')
      setZonas([]); setCentros([])
    } else {
      setEmpresas([]); setZonas([]); setCentros([])
      setEmpresaSel(''); setZonaSel(''); setCentroSel('')
    }
  })() }, [asignarCentro, rolSel])

  useEffect(() => { (async () => {
    if (!asignarCentro || !empresaSel) { setZonas([]); setZonaSel(''); return }
    await loadZonas(empresaSel); setZonaSel(''); setCentros([]); setCentroSel('')
  })() }, [empresaSel, asignarCentro])

  useEffect(() => { (async () => {
    if (!asignarCentro || !zonaSel) { setCentros([]); setCentroSel(''); return }
    await loadCentros(zonaSel); setCentroSel('')
  })() }, [zonaSel, asignarCentro])

  // ===== crear =====
  const crear = async () => {
    setCreateMsg('')
    const nombre = document.getElementById('nuNombre').value.trim()
    const email  = document.getElementById('nuEmail').value.trim()
    const rut    = document.getElementById('nuRut').value.trim()
    if (!nombre || !email || !rut) return setCreateMsg('Completa nombre, email y RUT (sin DV).')

    try {
      const body = {
        nombre, email, rutBody: rut,
        rol: rolSel,
        centroId: (rolSel === 'centro' && asignarCentro && centroSel) ? centroSel : null
      }
      const res = await fetch('/api/admin/create-user', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
      })
      const j = await res.json().catch(()=>({error:`Error parseando respuesta (${res.status})`}))
      if (!res.ok || j?.error) return setCreateMsg(`❌ ${j?.error || `Fallo (${res.status})`}`)
      setCreateMsg(j?.warning ? `⚠️ ${j.warning}` : '✅ Usuario creado')
      await loadUsuarios()
    } catch (err) { setCreateMsg(`❌ ${err.message || String(err)}`) }
  }

  // ===== transferencia =====
  const transferir = async () => {
    setTrMsg('')
    if (!userSel) return setTrMsg('Elige el usuario a transferir')
    if (!centroSel) return setTrMsg('Selecciona el centro destino')
    const { error } = await supabase.rpc('rpc_transferir_usuario_definitivo', {
      p_user_id: userSel, p_nuevo_centro_id: centroSel, p_fecha_inicio: null
    })
    setTrMsg(error ? `❌ ${error.message}` : '✅ Transferido')
  }

  // ===== cambiar rol =====
  const updateRol = async (userId) => {
    const nuevoRol = rolDraft[userId]
    setRowMsg(prev => ({ ...prev, [userId]: '' }))
    if (!nuevoRol || !['admin','oficina','centro'].includes(nuevoRol)) {
      return setRowMsg(prev => ({ ...prev, [userId]: 'Rol inválido' }))
    }
    const { error } = await supabase.from('profiles').update({ rol: nuevoRol }).eq('user_id', userId)
    if (error) setRowMsg(prev => ({ ...prev, [userId]: '❌ ' + error.message }))
    else { setRowMsg(prev => ({ ...prev, [userId]: '✅ Rol actualizado' })); await loadUsuarios() }
  }

  // ===== listado/búsqueda =====
  const usuariosFiltrados = useMemo(() => {
    const q = qUser.trim().toLowerCase()
    if (!q) return usuarios
    return (usuarios || []).filter(u =>
      [u.nombre, u.correo, u.rut, u.rol].some(v => String(v||'').toLowerCase().includes(q))
    )
  }, [qUser, usuarios])
  const centrosOnly = useMemo(() => (usuarios || []).filter(u => u.rol === 'centro'), [usuarios])

  return (
    <div>
      {/* Crear */}
      <section style={box}>
        <h3>Crear usuario</h3>
        <div style={row}>
          <input id="nuNombre" style={input} placeholder="Nombre completo" />
          <input id="nuEmail"  style={input} placeholder="Email" />
          <input id="nuRut"    style={input} placeholder="RUT sin DV (ej: 12345678)" />
          <select id="nuRol" style={input} value={rolSel} onChange={(e)=>setRolSel(e.target.value)}>
            <option value="centro">centro</option>
            <option value="oficina">oficina</option>
            <option value="admin">admin</option>
          </select>
          {rolSel === 'centro' && (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={asignarCentro} onChange={(e)=>setAsignarCentro(e.target.checked)} />
              Asignar a un centro ahora
            </label>
          )}
        </div>

        {rolSel === 'centro' && asignarCentro && (
          <div style={{ ...row, marginTop:4 }}>
            <select style={input} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)}>
              <option value="">(elige empresa)</option>
              {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <select style={input} value={zonaSel} onChange={(e)=>setZonaSel(e.target.value)} disabled={!empresaSel}>
              <option value="">{empresaSel ? '(elige zona)' : '(zona)'}</option>
              {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select>
            <select style={input} value={centroSel} onChange={(e)=>setCentroSel(e.target.value)} disabled={!zonaSel}>
              <option value="">(sin centro — reserva)</option>
              {centros.map(c=> <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}

        <div style={row}><button style={btn} onClick={crear}>Guardar</button></div>
        <p>{createMsg}</p>
        <p style={{fontSize:12, color:'#555', marginTop:8}}>
          Nota: si <b>no</b> asignas centro, el operario queda <b>en reserva</b> (sin empresa/zona). Los roles <b>admin</b> y <b>oficina</b> nunca llevan centro.
        </p>
      </section>

      {/* Transferencia */}
      <section style={box}>
        <h3>Transferencia definitiva (RPC)</h3>
        <div style={row}>
          <select style={input} value={userSel} onChange={(e)=>setUserSel(e.target.value)}>
            <option value="">Elige usuario (rol: centro)</option>
            {centrosOnly.map(u => (
              <option key={u.user_id} value={u.user_id}>
                {u.nombre} — {u.correo}
              </option>
            ))}
          </select>
          <select style={input} value={empresaSel} onChange={(e)=>setEmpresaSel(e.target.value)}>
            <option value="">(empresa)</option>
            {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <select style={input} value={zonaSel} onChange={(e)=>setZonaSel(e.target.value)} disabled={!empresaSel}>
            <option value="">(zona)</option>
            {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
          <select style={input} value={centroSel} onChange={(e)=>setCentroSel(e.target.value)} disabled={!zonaSel}>
            <option value="">(centro)</option>
            {centros.map(c=> <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button style={btn} onClick={transferir}>Transferir</button>
        </div>
        <p>{trMsg}</p>
      </section>

      {/* Lista */}
      <section style={box}>
        <h3>Usuarios</h3>
        <div style={row}>
          <input style={input} placeholder="Buscar (nombre, email, rut, rol)…" value={qUser} onChange={(e)=>setQUser(e.target.value)} />
          <button style={btn} onClick={loadUsuarios}>Refrescar</button>
        </div>
        {listMsg && <p>{listMsg}</p>}

        <table style={tbl}>
          <thead>
            <tr>
              <th style={thtd}>Nombre</th>
              <th style={thtd}>Email</th>
              <th style={thtd}>RUT</th>
              <th style={thtd}>Rol</th>
              <th style={thtd}>Estado</th>
              <th style={thtd}>Acciones</th>
              <th style={thtd}>Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {usuariosFiltrados.map(u => (
              <tr key={u.user_id}>
                <td style={thtd}>{u.nombre}</td>
                <td style={thtd}>{u.correo}</td>
                <td style={thtd}>{u.rut}</td>
                <td style={thtd}>
                  <select
                    value={rolDraft[u.user_id] ?? u.rol}
                    onChange={(e)=>setRolDraft(prev=>({ ...prev, [u.user_id]: e.target.value }))}
                    style={input}
                  >
                    <option value="centro">centro</option>
                    <option value="oficina">oficina</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td style={thtd}>
                  <span style={chip(u.is_active)}>{u.is_active ? 'Activo' : 'Suspendido'}</span>
                  {u.must_change_password ? <span style={{...chip(true), marginLeft:8}}>Debe cambiar clave</span> : null}
                </td>
                <td style={thtd}>
                  <button
                    style={btn}
                    onClick={async ()=>{
                      const { error } = await supabase.from('profiles').update({ is_active: !u.is_active }).eq('user_id', u.user_id)
                      if (error) setRowMsg(prev=>({ ...prev, [u.user_id]: '❌ ' + error.message }))
                      else { setRowMsg(prev=>({ ...prev, [u.user_id]: '✅ Estado actualizado' })); loadUsuarios() }
                    }}
                  >
                    {u.is_active ? 'Suspender' : 'Activar'}
                  </button>
                  <button
                    style={{...btn, marginLeft:8}}
                    onClick={()=>updateRol(u.user_id)}
                  >
                    Actualizar rol
                  </button>
                </td>
                <td style={thtd}>{rowMsg[u.user_id] || ''}</td>
              </tr>
            ))}
            {!usuariosFiltrados.length && (
              <tr><td style={thtd} colSpan={7}>Sin usuarios</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}



