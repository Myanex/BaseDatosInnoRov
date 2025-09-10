import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const box = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:960 }
const row = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const input = { padding:8, border:'1px solid #bbb', borderRadius:8 }

export default function UsuariosAdmin() {
  const [createMsg, setCreateMsg] = useState('')
  const [trMsg, setTrMsg] = useState('')

  const [empresas, setEmpresas] = useState([])
  const [zonas, setZonas] = useState([])
  const [centros, setCentros] = useState([])

  const [empresaSel, setEmpresaSel] = useState('')
  const [zonaSel, setZonaSel] = useState('')
  const [centroSel, setCentroSel] = useState('')

  const [rolSel, setRolSel] = useState('centro')

  useEffect(() => { (async () => {
    const { data } = await supabase.from('empresas').select('id, nombre').order('nombre')
    setEmpresas(data || [])
    if (data?.length) setEmpresaSel(data[0].id)
  })() }, [])

  useEffect(() => { (async () => {
    if (!empresaSel) { setZonas([]); setZonaSel(''); return }
    const { data } = await supabase.from('zonas').select('id, nombre').eq('empresa_id', empresaSel).order('nombre')
    setZonas(data || [])
    setZonaSel(data?.[0]?.id || '')
  })() }, [empresaSel])

  useEffect(() => { (async () => {
    if (!zonaSel) { setCentros([]); setCentroSel(''); return }
    const { data } = await supabase.from('centros').select('id, nombre').eq('zona_id', zonaSel).order('nombre')
    setCentros(data || [])
    setCentroSel(data?.[0]?.id || '')
  })() }, [zonaSel])

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
        centroId: (rolSel === 'centro' && centroSel) ? centroSel : null  // opcional
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

          {/* Asignación opcional solo si rol = centro */}
          {rolSel === 'centro' && (
            <>
              <select style={input} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)}>
                {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
              <select style={input} value={zonaSel} onChange={e=>setZonaSel(e.target.value)}>
                {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
              </select>
              <select style={input} value={centroSel} onChange={e=>setCentroSel(e.target.value)}>
                <option value="">(sin centro — reserva)</option>
                {centros.map(c=> <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </>
          )}

          <button style={btn} onClick={crear}>Guardar</button>
        </div>
        <p>{createMsg}</p>
        <p style={{fontSize:12, color:'#555'}}>Nota: Operario sin centro queda <b>en reserva</b>. Admin y Oficina no llevan centro asignado.</p>
      </section>

      <section style={box}>
        <h3>Transferencia definitiva (RPC)</h3>
        <div style={row}>
          <input id="trUserId" style={input} placeholder="user_id a transferir" />
          <select style={input} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)}>
            {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <select style={input} value={zonaSel} onChange={e=>setZonaSel(e.target.value)}>
            {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
          <select style={input} value={centroSel} onChange={e=>setCentroSel(e.target.value)}>
            {centros.map(c=> <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button style={btn} onClick={transferir}>Transferir</button>
        </div>
        <p>{trMsg}</p>
      </section>
    </div>
  )
}



