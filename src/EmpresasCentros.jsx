import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

const box  = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0' }
const row  = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn  = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const inp  = { padding:8, border:'1px solid #bbb', borderRadius:8 }
const tbl  = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 4px', textAlign:'left' }

export default function EmpresasCentros({ profile }) {
  const isAdmin = profile?.rol === 'admin'
  const [empresas, setEmpresas] = useState([])
  const [centros, setCentros] = useState([])
  const [selEmp, setSelEmp] = useState(null)

  // formularios
  const [emp, setEmp] = useState({ id:null, nombre:'', is_active:true })
  const [cen, setCen] = useState({ id:null, nombre:'', fecha_inicio:'', is_active:true })

  const loadEmpresas = async () => {
    const { data, error } = await supabase.from('empresas').select('*').order('nombre', { ascending:true })
    if (!error) {
      setEmpresas(data || [])
      if (!selEmp && data?.length) setSelEmp(data[0])
    }
  }

  const loadCentros = async (empresa_id) => {
    if (!empresa_id) { setCentros([]); return }
    const { data, error } = await supabase.from('centros')
      .select('id, nombre, is_active, fecha_inicio, empresa_id')
      .eq('empresa_id', empresa_id)
      .order('nombre', { ascending:true })
    if (!error) setCentros(data || [])
  }

  useEffect(() => { loadEmpresas() }, [])
  useEffect(() => { loadCentros(selEmp?.id) }, [selEmp?.id])

  // EMPRESAS
  const guardarEmpresa = async () => {
    if (!isAdmin) return alert('Solo Admin')
    if (!emp.nombre.trim()) return alert('Nombre requerido')
    const payload = { nombre: emp.nombre.trim(), is_active: !!emp.is_active }
    if (emp.id) {
      const { error } = await supabase.from('empresas').update(payload).eq('id', emp.id)
      if (error) return alert(error.message)
    } else {
      const { error } = await supabase.from('empresas').insert(payload)
      if (error) return alert(error.message)
    }
    setEmp({ id:null, nombre:'', is_active:true })
    await loadEmpresas()
  }

  // CENTROS
  const guardarCentro = async () => {
    if (!isAdmin) return alert('Solo Admin')
    if (!selEmp?.id) return alert('Selecciona empresa')
    if (!cen.nombre.trim()) return alert('Nombre requerido')

    const payload = {
      nombre: cen.nombre.trim(),
      empresa_id: selEmp.id,
      is_active: !!cen.is_active,
      fecha_inicio: cen.fecha_inicio || null
    }
    if (cen.id) {
      const { error } = await supabase.from('centros').update(payload).eq('id', cen.id)
      if (error) return alert(error.message)
    } else {
      const { error } = await supabase.from('centros').insert(payload)
      if (error) return alert(error.message)
    }
    setCen({ id:null, nombre:'', fecha_inicio:'', is_active:true })
    await loadCentros(selEmp.id)
  }

  const copiar = async (txt) => {
    try { await navigator.clipboard.writeText(txt); alert('ID copiado') } catch {}
  }

  return (
    <div>
      <h2>Admin · Empresas & Centros</h2>

      {/* EMPRESAS */}
      <section style={box}>
        <h3>Empresas</h3>
        <div style={row}>
          <input style={inp} placeholder="Nombre empresa"
            value={emp.nombre} onChange={e=>setEmp(v=>({...v, nombre:e.target.value}))}/>
          <label><input type="checkbox" checked={emp.is_active}
            onChange={e=>setEmp(v=>({...v, is_active:e.target.checked}))}/> Activa</label>
          <button style={btn} onClick={guardarEmpresa} disabled={!isAdmin}>Guardar</button>
          {emp.id && <span>ID: {emp.id}</span>}
        </div>

        <table style={tbl}>
          <thead><tr><th style={thtd}>Nombre</th><th style={thtd}>Activa</th><th style={thtd}>ID</th><th style={thtd}>Acciones</th></tr></thead>
          <tbody>
            {empresas.map(e=>(
              <tr key={e.id}>
                <td style={thtd}>{e.nombre}</td>
                <td style={thtd}>{e.is_active ? 'Sí' : 'No'}</td>
                <td style={thtd}><code>{e.id}</code></td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>{ setEmp({ id:e.id, nombre:e.nombre, is_active:!!e.is_active }); setSelEmp(e); }}>Editar</button>{' '}
                  <button style={btn} onClick={()=>copiar(e.id)}>Copiar ID</button>{' '}
                  <button style={btn} onClick={()=>setSelEmp(e)}>Ver centros</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* CENTROS */}
      <section style={box}>
        <h3>Centros {selEmp ? `— ${selEmp.nombre}` : ''}</h3>
        <div style={row}>
          <select style={inp} value={selEmp?.id || ''} onChange={e=>{
            const eId = e.target.value; const obj = empresas.find(x=>x.id===eId); setSelEmp(obj || null);
          }}>
            {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>

          <input style={inp} placeholder="Nombre centro"
            value={cen.nombre} onChange={e=>setCen(v=>({...v, nombre:e.target.value}))}/>
          <input style={inp} type="date" value={cen.fecha_inicio}
            onChange={e=>setCen(v=>({...v, fecha_inicio:e.target.value}))}/>
          <label><input type="checkbox" checked={cen.is_active}
            onChange={e=>setCen(v=>({...v, is_active:e.target.checked}))}/> Activo</label>
          <button style={btn} onClick={guardarCentro} disabled={!isAdmin}>Guardar</button>
          {cen.id && <span>ID: {cen.id}</span>}
        </div>

        <table style={tbl}>
          <thead><tr>
            <th style={thtd}>Nombre</th><th style={thtd}>Inicio</th><th style={thtd}>Activo</th><th style={thtd}>ID</th><th style={thtd}>Acciones</th>
          </tr></thead>
          <tbody>
            {centros.map(c=>(
              <tr key={c.id}>
                <td style={thtd}>{c.nombre}</td>
                <td style={thtd}>{c.fecha_inicio || '—'}</td>
                <td style={thtd}>{c.is_active ? 'Sí' : 'No'}</td>
                <td style={thtd}><code>{c.id}</code></td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>setCen({
                    id:c.id, nombre:c.nombre, fecha_inicio:c.fecha_inicio || '', is_active:!!c.is_active
                  })}>Editar</button>{' '}
                  <button style={btn} onClick={()=>copiar(c.id)}>Copiar ID</button>
                </td>
              </tr>
            ))}
            {centros.length === 0 && (
              <tr><td style={thtd} colSpan={5}>No hay centros en esta empresa.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
