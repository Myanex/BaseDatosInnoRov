import React, { useEffect, useState } from 'react'
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
  const [selEmp, setSelEmp] = useState(null)
  const [zonas, setZonas] = useState([])
  const [centros, setCentros] = useState([])

  const [emp, setEmp] = useState({ id:null, nombre:'', is_active:true })
  const [zo,  setZo ] = useState({ id:null, nombre:'', region:'', is_active:true })
  const [cen, setCen] = useState({ id:null, nombre:'', fecha_inicio:'', is_active:true, zona_id:'' })

  const loadEmpresas = async () => {
    const { data } = await supabase.from('empresas').select('*').order('nombre')
    setEmpresas(data || [])
    if (!selEmp && data?.length) setSelEmp(data[0])
  }
  const loadZonas = async (empresa_id) => {
    if (!empresa_id) return setZonas([])
    const { data } = await supabase.from('zonas')
      .select('id, nombre, region, is_active, empresa_id')
      .eq('empresa_id', empresa_id).order('nombre')
    setZonas(data || [])
  }
  const loadCentros = async (empresa_id) => {
    if (!empresa_id) return setCentros([])
    const { data } = await supabase.from('centros')
      .select('id, nombre, fecha_inicio, is_active, empresa_id, zona_id')
      .eq('empresa_id', empresa_id).order('nombre')
    setCentros(data || [])
  }

  useEffect(() => { loadEmpresas() }, [])
  useEffect(() => { loadZonas(selEmp?.id); loadCentros(selEmp?.id) }, [selEmp?.id])

  const copiar = async (txt) => { try { await navigator.clipboard.writeText(txt); alert('ID copiado'); } catch {} }

  // EMPRESAS
  const guardarEmpresa = async () => {
    if (!isAdmin) return alert('Solo Admin')
    if (!emp.nombre.trim()) return alert('Nombre requerido')
    const payload = { nombre: emp.nombre.trim(), is_active: !!emp.is_active }
    if (emp.id) await supabase.from('empresas').update(payload).eq('id', emp.id)
    else        await supabase.from('empresas').insert(payload)
    setEmp({ id:null, nombre:'', is_active:true })
    await loadEmpresas()
  }

  // ZONAS
  const guardarZona = async () => {
    if (!isAdmin) return alert('Solo Admin')
    if (!selEmp?.id) return alert('Selecciona empresa')
    if (!zo.nombre.trim()) return alert('Nombre zona requerido')
    const payload = { empresa_id: selEmp.id, nombre: zo.nombre.trim(), region: zo.region?.trim() || null, is_active: !!zo.is_active }
    if (zo.id) await supabase.from('zonas').update(payload).eq('id', zo.id)
    else       await supabase.from('zonas').insert(payload)
    setZo({ id:null, nombre:'', region:'', is_active:true })
    await loadZonas(selEmp.id)
  }

  // CENTROS
  const guardarCentro = async () => {
    if (!isAdmin) return alert('Solo Admin')
    if (!selEmp?.id) return alert('Selecciona empresa')
    if (!cen.nombre.trim()) return alert('Nombre requerido')
    if (!cen.zona_id) return alert('Selecciona zona')

    const payload = {
      nombre: cen.nombre.trim(),
      empresa_id: selEmp.id,
      zona_id: cen.zona_id,
      is_active: !!cen.is_active,
      fecha_inicio: cen.fecha_inicio || null
    }
    if (cen.id) await supabase.from('centros').update(payload).eq('id', cen.id)
    else        await supabase.from('centros').insert(payload)
    setCen({ id:null, nombre:'', fecha_inicio:'', is_active:true, zona_id:'' })
    await loadCentros(selEmp.id)
  }

  return (
    <div>
      <h2>Admin · Empresas / Zonas / Centros</h2>

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
          <div style={{flex:1}}/>
          <select style={inp} value={selEmp?.id || ''} onChange={e=>{
            const o = empresas.find(x=>x.id===e.target.value); setSelEmp(o || null);
          }}>
            {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
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
                  <button style={btn} onClick={()=>setEmp({ id:e.id, nombre:e.nombre, is_active:!!e.is_active })}>Editar</button>{' '}
                  <button style={btn} onClick={()=>copiar(e.id)}>Copiar ID</button>{' '}
                  <button style={btn} onClick={()=>setSelEmp(e)}>Seleccionar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ZONAS */}
      <section style={box}>
        <h3>Zonas {selEmp ? `— ${selEmp.nombre}` : ''}</h3>
        <div style={row}>
          <input style={inp} placeholder="Nombre zona (ej: Puerto Montt)"
            value={zo.nombre} onChange={e=>setZo(v=>({...v, nombre:e.target.value}))}/>
          <input style={inp} placeholder="Región (opcional)"
            value={zo.region} onChange={e=>setZo(v=>({...v, region:e.target.value}))}/>
          <label><input type="checkbox" checked={zo.is_active}
            onChange={e=>setZo(v=>({...v, is_active:e.target.checked}))}/> Activa</label>
          <button style={btn} onClick={guardarZona} disabled={!isAdmin}>Guardar</button>
        </div>

        <table style={tbl}>
          <thead><tr><th style={thtd}>Zona</th><th style={thtd}>Región</th><th style={thtd}>Activa</th><th style={thtd}>ID</th><th style={thtd}>Acciones</th></tr></thead>
          <tbody>
            {zonas.map(z=>(
              <tr key={z.id}>
                <td style={thtd}>{z.nombre}</td>
                <td style={thtd}>{z.region || '—'}</td>
                <td style={thtd}>{z.is_active ? 'Sí' : 'No'}</td>
                <td style={thtd}><code>{z.id}</code></td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>setZo({ id:z.id, nombre:z.nombre, region:z.region || '', is_active:!!z.is_active })}>Editar</button>
                </td>
              </tr>
            ))}
            {zonas.length===0 && <tr><td style={thtd} colSpan={5}>No hay zonas</td></tr>}
          </tbody>
        </table>
      </section>

      {/* CENTROS */}
      <section style={box}>
        <h3>Centros {selEmp ? `— ${selEmp.nombre}` : ''}</h3>
        <div style={row}>
          <select style={inp} value={cen.zona_id} onChange={e=>setCen(v=>({...v, zona_id:e.target.value}))}>
            <option value="">(elige zona)</option>
            {zonas.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
          <input style={inp} placeholder="Nombre centro"
            value={cen.nombre} onChange={e=>setCen(v=>({...v, nombre:e.target.value}))}/>
          <input style={inp} type="date"
            value={cen.fecha_inicio} onChange={e=>setCen(v=>({...v, fecha_inicio:e.target.value}))}/>
          <label><input type="checkbox" checked={cen.is_active}
            onChange={e=>setCen(v=>({...v, is_active:e.target.checked}))}/> Activo</label>
          <button style={btn} onClick={guardarCentro} disabled={!isAdmin}>Guardar</button>
        </div>

        <table style={tbl}>
          <thead><tr>
            <th style={thtd}>Centro</th><th style={thtd}>Zona</th><th style={thtd}>Inicio</th><th style={thtd}>Activo</th><th style={thtd}>ID</th><th style={thtd}>Acciones</th>
          </tr></thead>
          <tbody>
            {centros.map(c=>(
              <tr key={c.id}>
                <td style={thtd}>{c.nombre}</td>
                <td style={thtd}>{zonas.find(z=>z.id===c.zona_id)?.nombre || '—'}</td>
                <td style={thtd}>{c.fecha_inicio || '—'}</td>
                <td style={thtd}>{c.is_active ? 'Sí' : 'No'}</td>
                <td style={thtd}><code>{c.id}</code></td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>setCen({
                    id:c.id, nombre:c.nombre, fecha_inicio:c.fecha_inicio || '', is_active:!!c.is_active, zona_id:c.zona_id || ''
                  })}>Editar</button>
                </td>
              </tr>
            ))}
            {centros.length===0 && <tr><td style={thtd} colSpan={6}>No hay centros para esta empresa</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

