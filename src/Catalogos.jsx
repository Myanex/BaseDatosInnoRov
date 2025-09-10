import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

const box = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0' }
const row = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const input = { padding:8, border:'1px solid #bbb', borderRadius:8 }
const table = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 4px', textAlign:'left' }

function useCrud(tableName, orderBy = 'codigo') {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    const { data, error } = await supabase.from(tableName).select('*').order(orderBy, { ascending:true })
    if (error) setError(error.message)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [tableName])
  return { rows, loading, error, reload: load }
}

export default function Catalogos({ profile }) {
  const isAdmin = profile?.rol === 'admin'
  const [tab, setTab] = useState('tipo') // tipo | estadoComp | estadoPuerto | actividad

  return (
    <div>
      <h2>Admin · Catálogos</h2>
      <div style={{...row, marginTop:0}}>
        {['tipo','estadoComp','estadoPuerto','actividad'].map(k => (
          <button key={k}
            style={{...btn, background: tab===k ? '#f5f5f5' : 'white'}}
            onClick={()=>setTab(k)}>
            {k==='tipo' ? 'Tipo componente'
             : k==='estadoComp' ? 'Estado componente'
             : k==='estadoPuerto' ? 'Estado puerto'
             : 'Actividades'}
          </button>
        ))}
      </div>

      {tab==='tipo'        && <TipoComponente  isAdmin={isAdmin} />}
      {tab==='estadoComp'  && <EstadoComponente isAdmin={isAdmin} />}
      {tab==='estadoPuerto'&& <EstadoPuerto     isAdmin={isAdmin} />}
      {tab==='actividad'   && <ActividadCatalogo isAdmin={isAdmin} />}
    </div>
  )
}

function TipoComponente({ isAdmin }) {
  const { rows, loading, error, reload } = useCrud('tipo_componente')
  const [form, setForm] = useState({ codigo:'', nombre:'' })

  const save = async () => {
    if (!isAdmin) return alert('Solo Admin puede editar')
    if (!form.codigo.trim() || !form.nombre.trim()) return alert('Completa código y nombre')
    const { error } = await supabase.from('tipo_componente').upsert([{
      codigo: form.codigo.trim().toUpperCase(), nombre: form.nombre.trim()
    }], { onConflict: 'codigo' })
    if (error) return alert(error.message)
    setForm({ codigo:'', nombre:'' }); reload()
  }

  return (
    <section style={box}>
      <h3>Tipo de componente</h3>
      <div style={row}>
        <input style={input} placeholder="CÓDIGO (ej: ROV)"
          value={form.codigo} onChange={e=>setForm(f=>({...f, codigo:e.target.value}))}/>
        <input style={input} placeholder="Nombre (ej: ROV)"
          value={form.nombre} onChange={e=>setForm(f=>({...f, nombre:e.target.value}))}/>
        <button style={btn} onClick={save} disabled={!isAdmin}>Guardar</button>
      </div>
      {loading && <p>Cargando…</p>}
      {error && <p style={{color:'#b00020'}}>{error}</p>}
      <table style={table}>
        <thead><tr><th style={thtd}>Código</th><th style={thtd}>Nombre</th><th/></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td style={thtd}>{r.codigo}</td>
              <td style={thtd}>{r.nombre}</td>
              <td style={thtd}><button style={btn} disabled={!isAdmin} onClick={()=>setForm({codigo:r.codigo, nombre:r.nombre})}>Editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function EstadoComponente({ isAdmin }) {
  const { rows, loading, error, reload } = useCrud('estado_componente')
  const [form, setForm] = useState({ codigo:'', nombre:'' })
  const save = async () => {
    if (!isAdmin) return alert('Solo Admin puede editar')
    if (!form.codigo.trim() || !form.nombre.trim()) return alert('Completa código y nombre')
    const { error } = await supabase.from('estado_componente').upsert([{
      codigo: form.codigo.trim().toLowerCase(), nombre: form.nombre.trim()
    }], { onConflict: 'codigo' })
    if (error) return alert(error.message)
    setForm({ codigo:'', nombre:'' }); reload()
  }
  return (
    <section style={box}>
      <h3>Estado de componente</h3>
      <div style={row}>
        <input style={input} placeholder="código (ej: operativo)"
          value={form.codigo} onChange={e=>setForm(f=>({...f, codigo:e.target.value}))}/>
        <input style={input} placeholder="Nombre (ej: Operativo)"
          value={form.nombre} onChange={e=>setForm(f=>({...f, nombre:e.target.value}))}/>
        <button style={btn} onClick={save} disabled={!isAdmin}>Guardar</button>
      </div>
      {loading && <p>Cargando…</p>}
      {error && <p style={{color:'#b00020'}}>{error}</p>}
      <table style={table}>
        <thead><tr><th style={thtd}>Código</th><th style={thtd}>Nombre</th><th/></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td style={thtd}>{r.codigo}</td>
              <td style={thtd}>{r.nombre}</td>
              <td style={thtd}><button style={btn} disabled={!isAdmin} onClick={()=>setForm({codigo:r.codigo, nombre:r.nombre})}>Editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function EstadoPuerto({ isAdmin }) {
  const { rows, loading, error, reload } = useCrud('estado_puerto')
  const [form, setForm] = useState({ codigo:'', nombre:'' })
  const save = async () => {
    if (!isAdmin) return alert('Solo Admin puede editar')
    if (!form.codigo.trim() || !form.nombre.trim()) return alert('Completa código y nombre')
    const { error } = await supabase.from('estado_puerto').upsert([{
      codigo: form.codigo.trim().toLowerCase(), nombre: form.nombre.trim()
    }], { onConflict: 'codigo' })
    if (error) return alert(error.message)
    setForm({ codigo:'', nombre:'' }); reload()
  }
  return (
    <section style={box}>
      <h3>Estado de puerto</h3>
      <div style={row}>
        <input style={input} placeholder="código (abierto/cerrado)"
          value={form.codigo} onChange={e=>setForm(f=>({...f, codigo:e.target.value}))}/>
        <input style={input} placeholder="Nombre (Abierto/Cerrado)"
          value={form.nombre} onChange={e=>setForm(f=>({...f, nombre:e.target.value}))}/>
        <button style={btn} onClick={save} disabled={!isAdmin}>Guardar</button>
      </div>
      {loading && <p>Cargando…</p>}
      {error && <p style={{color:'#b00020'}}>{error}</p>}
      <table style={table}>
        <thead><tr><th style={thtd}>Código</th><th style={thtd}>Nombre</th><th/></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td style={thtd}>{r.codigo}</td>
              <td style={thtd}>{r.nombre}</td>
              <td style={thtd}><button style={btn} disabled={!isAdmin} onClick={()=>setForm({codigo:r.codigo, nombre:r.nombre})}>Editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ActividadCatalogo({ isAdmin }) {
  const { rows, loading, error, reload } = useCrud('actividad_catalogo')
  const [form, setForm] = useState({ codigo:'', nombre:'', requiere_equipo:true, is_active:true })
  const save = async () => {
    if (!isAdmin) return alert('Solo Admin puede editar')
    if (!form.codigo.trim() || !form.nombre.trim()) return alert('Completa código y nombre')
    const payload = {
      codigo: form.codigo.trim().toLowerCase(),
      nombre: form.nombre.trim(),
      requiere_equipo: !!form.requiere_equipo,
      is_active: !!form.is_active
    }
    const { error } = await supabase.from('actividad_catalogo').upsert([payload], { onConflict:'codigo' })
    if (error) return alert(error.message)
    setForm({ codigo:'', nombre:'', requiere_equipo:true, is_active:true }); reload()
  }
  return (
    <section style={box}>
      <h3>Actividades</h3>
      <div style={row}>
        <input style={input} placeholder="código (ej: extraccion_mortalidad)"
          value={form.codigo} onChange={e=>setForm(f=>({...f, codigo:e.target.value}))}/>
        <input style={input} placeholder="Nombre (ej: Extracción de mortalidad)"
          value={form.nombre} onChange={e=>setForm(f=>({...f, nombre:e.target.value}))}/>
        <label><input type="checkbox"
          checked={form.requiere_equipo}
          onChange={e=>setForm(f=>({...f, requiere_equipo:e.target.checked}))}/> Requiere equipo</label>
        <label><input type="checkbox"
          checked={form.is_active}
          onChange={e=>setForm(f=>({...f, is_active:e.target.checked}))}/> Activa</label>
        <button style={btn} onClick={save} disabled={!isAdmin}>Guardar</button>
      </div>
      {loading && <p>Cargando…</p>}
      {error && <p style={{color:'#b00020'}}>{error}</p>}
      <table style={table}>
        <thead><tr>
          <th style={thtd}>Código</th><th style={thtd}>Nombre</th>
          <th style={thtd}>Requiere equipo</th><th style={thtd}>Activa</th><th/>
        </tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td style={thtd}>{r.codigo}</td>
              <td style={thtd}>{r.nombre}</td>
              <td style={thtd}>{r.requiere_equipo ? 'Sí' : 'No'}</td>
              <td style={thtd}>{r.is_active ? 'Sí' : 'No'}</td>
              <td style={thtd}>
                <button style={btn} disabled={!isAdmin}
                  onClick={()=>setForm({
                    codigo:r.codigo, nombre:r.nombre,
                    requiere_equipo: !!r.requiere_equipo, is_active: !!r.is_active
                  })}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
