import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const box = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:960 }
const row = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const input = { padding:8, border:'1px solid #bbb', borderRadius:8 }

export default function UsuariosAdmin() {
  const [createMsg, setCreateMsg] = useState('')
  const [trMsg, setTrMsg] = useState('')
  const [centros, setCentros] = useState([])
  const [centroSel, setCentroSel] = useState('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('centros').select('id, nombre, empresa_id').order('nombre')
      setCentros(data || [])
      if (data?.length) setCentroSel(data[0].id)
    })()
  }, [])

  const crear = async () => {
    setCreateMsg('')
    const body = {
      nombre: document.getElementById('nuNombre').value.trim(),
      email: document.getElementById('nuEmail').value.trim(),
      rutBody: document.getElementById('nuRut').value.trim(),
      rol: document.getElementById('nuRol').value,
      centroId: centroSel
    }
    const res = await fetch('/api/admin/create-user', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    })
    const j = await res.json()
    setCreateMsg(j.error ? `❌ ${j.error}` : '✅ Usuario creado')
  }

  const transferir = async () => {
    setTrMsg('')
    const userId = document.getElementById('trUserId').value.trim()
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
          <select id="nuRol"   style={input}>
            <option value="centro">centro</option>
            <option value="oficina">oficina</option>
            <option value="admin">admin</option>
          </select>
          <select style={input} value={centroSel} onChange={e=>setCentroSel(e.target.value)}>
            {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button style={btn} onClick={crear}>Crear usuario</button>
        </div>
        <p>{createMsg}</p>
      </section>

      <section style={box}>
        <h3>Transferencia definitiva (RPC)</h3>
        <div style={row}>
          <input id="trUserId" style={input} placeholder="user_id a transferir" />
          <select style={input} value={centroSel} onChange={e=>setCentroSel(e.target.value)}>
            {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button style={btn} onClick={transferir}>Transferir</button>
        </div>
        <p>{trMsg}</p>
      </section>
    </div>
  )
}

