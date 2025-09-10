import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const box = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:960 }
const row = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const input = { padding:8, border:'1px solid #bbb', borderRadius:8 }

export default function UsuariosAdmin() {
  const [createMsg, setCreateMsg] = useState('')
  const [trMsg, setTrMsg] = useState('')

  // catálogos (se cargan solo si asignarCentro === true)
  const [empresas, setEmpresas] = useState([])
  const [zonas, setZonas] = useState([])
  const [centros, setCentros] = useState([])

  // selección
  const [rolSel, setRolSel] = useState('centro')
  const [asignarCentro, setAsignarCentro] = useState(false)

  const [empresaSel, setEmpresaSel] = useState('')
  const [zonaSel, setZonaSel] = useState('')
  const [centroSel, setCentroSel] = useState('') // si queda '', va EN RESERVA

  // ====== cargar combos SOLO cuando hace falta ======
  useEffect(() => {
    if (rolSel !== 'centro') {
      setAsignarCentro(false)
      // limpiar selecciones
      setEmpresaSel(''); setZonaSel(''); setCentroSel('')
      setEmpresas([]); setZonas([]); setCentros([])
    }
  }, [rolSel])

  useEffect(() => {
    (async () => {
      if (rolSel === 'centro' && asignarCentro) {
        const { data } = await supabase.from('empresas').select('id, nombre').order('nombre')
        setEmpresas(data || [])
        // no selecciones automáticas: quedarán vacías si el user no elige nada
        setEmpresaSel(''); setZonaSel(''); setCentroSel('')
        setZonas([]); setCentros([])
      } else {
        setEmpresas([]); setZonas([]); setCentros([])
        setEmpresaSel(''); setZonaSel(''); setCentroSel('')
      }
    })()
  }, [asignarCentro, rolSel])

  useEffect(() => {
    (async () => {
      if (!asignarCentro || !empresaSel) { setZonas([]); setZonaSel(''); return }
      const { data } = await supabase.from('zonas').select('id, nombre').eq('empresa_id', empresaSel).order('nombre')
      setZonas(data || [])
      setZonaSel(''); setCentros([]); setCentroSel('')
    })()
  }, [empresaSel, asignarCentro])

  useEffect(() => {
    (async () => {
      if (!asignarCentro || !zonaSel) { setCentros([]); setCentroSel(''); return }
      const { data } = await supabase.from('centros').select('id, nombre').eq('zona_id', zonaSel).order('nombre')
      setCentros(data || [])
      setCentroSel('') // por defecto: reserva, hasta que elijan centro explícitamente
    })()
  }, [zonaSel, asignarCentro])

  // ====== acciones ======
  const crear = async () => {
    setCreateMsg('')
    const nombre = document.getElementById('nuNombre').value.trim()
    const email  = document.getElementById('nuEmail').value.trim()
    const rut    = document.getElementById('nuRut').value.trim()

    if (!nombre || !email || !rut) {
      return setCreateMsg('Completa nombre, email y RUT (sin DV).')
    }

    try {
      const body = {
        nombre,
        email,
        rutBody: rut,
        rol: rolSel,
        // Si NO asigna centro, va null => queda en RESERVA (sin empresa/zona)
        centroId: (rolSel === 'centro' && asignarCentro && centroSel) ? centroSel : null
      }

      const res = await fetch('/api/admin/create-user', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      })

      let j
      try { j = await res.json() } catch { j = { error: `Error parseando respuesta (${res.status})` } }

      if (!res.ok || j?.error) {
        return setCreateMsg(`❌ ${j?.error || `Fallo (${res.status})`}`)
      }
      setCreateMsg('✅ Usuario creado')
    } catch (err) {
      setCreateMsg(`❌ ${err.message || String(err)}`)
    }
  }

  const transferir = async () => {
    setTrMsg('')
    if (!centroSel) return setTrMsg('Selecciona centro destino')
    const userId = document.getElementById('trUserId').value.trim()
    if (!userId) return setTrMsg('Ingresa user_id a transferir')

    const { error } = await supabase.rpc('rpc_transferir_usuario_definitivo', {
      p_user_id: userId, p_nuevo_centro_id: centroSel, p_fecha_inicio: null
    })
    setTrMsg(error ? `❌ ${error.message}` : '✅ Transferido')
  }

  return (
    <div>
      <section style={box}>
        <h3>Crear usuario</h3>
        <div style={row}>
          <input id="nuNombre" style={input} placeholder="Nombre completo" />
          <input id="nuEmail"  style={input} placeholder="Email" />
          <input id="nuRut"    style={input} placeholder="RUT sin DV (ej: 12345678)" />

          <select
            id="nuRol"
            style={input}
            value={rolSel}
            onChange={(e)=>setRolSel(e.target.value)}
          >
            <option value="centro">centro</option>
            <option value="oficina">oficina</option>
            <option value="admin">admin</option>
          </select>

          {/* Toggle: Asignar centro ahora (solo para rol centro) */}
          {rolSel === 'centro' && (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              <input
                type="checkbox"
                checked={asignarCentro}
                onChange={(e)=>setAsignarCentro(e.target.checked)}
              />
              Asignar a un centro ahora
            </label>
          )}
        </div>

        {/* Combos visibles SOLO si decidió asignar ahora */}
        {rolSel === 'centro' && asignarCentro && (
          <div style={{ ...row, marginTop:4 }}>
            <select style={input} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)}>
              <option value="">(elige empresa)</option>
              {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>

            <select style={input} value={zonaSel} onChange={e=>setZonaSel(e.target.value)} disabled={!empresaSel}>
              <option value="">{empresaSel ? '(elige zona)' : '(zona)'}</option>
              {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select>

            <select style={input} value={centroSel} onChange={e=>setCentroSel(e.target.value)} disabled={!zonaSel}>
              <option value="">(sin centro — reserva)</option>
              {centros.map(c=> <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}

        <div style={row}>
          <button style={btn} onClick={crear}>Guardar</button>
        </div>
        <p>{createMsg}</p>

        <p style={{fontSize:12, color:'#555', marginTop:8}}>
          Nota: Si <b>no</b> asignas centro, el operario queda <b>en reserva</b> (sin empresa ni zona).
          Los roles <b>admin</b> y <b>oficina</b> nunca llevan centro/empresa/zona.
        </p>
      </section>

      <section style={box}>
        <h3>Transferencia definitiva (RPC)</h3>
        <div style={row}>
          <input id="trUserId" style={input} placeholder="user_id a transferir" />
          {/* Para transferir sí necesitas elegir destino */}
          <select style={input} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)}>
            <option value="">(empresa)</option>
            {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <select style={input} value={zonaSel} onChange={e=>setZonaSel(e.target.value)} disabled={!empresaSel}>
            <option value="">(zona)</option>
            {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
          <select style={input} value={centroSel} onChange={e=>setCentroSel(e.target.value)} disabled={!zonaSel}>
            <option value="">(centro)</option>
            {centros.map(c=> <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button style={btn} onClick={transferir}>Transferir</button>
        </div>
        <p>{trMsg}</p>
      </section>
    </div>
  )
}




