import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

const box  = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0' }
const row  = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn  = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const inp  = { padding:8, border:'1px solid #bbb', borderRadius:8 }
const tbl  = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 4px', textAlign:'left' }

export default function Inventario({ profile }) {
  const isAdminOrOficina = ['admin','oficina'].includes(profile?.rol)

  // catálogos
  const [tipos, setTipos] = useState([])
  const [estados, setEstados] = useState([])
  const [equipos, setEquipos] = useState([])

  // datos
  const [componentes, setComponentes] = useState([])
  const [montajesActivos, setMontajesActivos] = useState([]) // [{componente_id, equipo_id}]

  // formularios
  const [fComp, setFComp] = useState({
    tipo_componente_id:'', codigo:'', serie:'', estado_componente_id:'', fecha_ingreso:''
  })
  const [q, setQ] = useState('') // búsqueda
  const [fMontaje, setFMontaje] = useState({ componente_id:'', equipo_id:'', fecha_inicio:'', fecha_fin:'' })
  const [msg, setMsg] = useState('')

  const loadCatalogos = async () => {
    const [{ data: t }, { data: e }, { data: eq }] = await Promise.all([
      supabase.from('tipo_componente').select('id, codigo, nombre').order('nombre'),
      supabase.from('estado_componente').select('id, codigo, nombre').order('nombre'),
      supabase.from('equipos').select('id, codigo').order('codigo')
    ])
    setTipos(t || []); setEstados(e || []); setEquipos(eq || [])
  }

  const loadComponentes = async () => {
    const { data } = await supabase
      .from('componentes')
      .select('id, codigo, serie, tipo_componente_id, estado_componente_id, fecha_ingreso')
      .order('fecha_ingreso', { ascending:false })
    setComponentes(data || [])
  }

  const loadMontajesActivos = async () => {
    const { data } = await supabase
      .from('equipo_componente')
      .select('componente_id, equipo_id, fecha_inicio, fecha_fin')
      .is('fecha_fin', null)
    setMontajesActivos(data || [])
  }

  useEffect(() => {
    loadCatalogos()
    loadComponentes()
    loadMontajesActivos()
  }, [])

  const tipoById = (id) => tipos.find(t=>t.id===id)
  const estadoById = (id) => estados.find(e=>e.id===id)
  const equipoById = (id) => equipos.find(e=>e.id===id)

  // ====== Crear/actualizar componente ======
  const guardarComponente = async () => {
    setMsg('')
    if (!isAdminOrOficina) return setMsg('Solo admin/oficina pueden crear componentes')
    if (!fComp.tipo_componente_id || !fComp.codigo.trim() || !fComp.estado_componente_id) {
      return setMsg('Completa tipo, código y estado')
    }
    const payload = {
      tipo_componente_id: fComp.tipo_componente_id,
      codigo: fComp.codigo.trim(),
      serie: fComp.serie?.trim() || null,
      estado_componente_id: fComp.estado_componente_id,
      fecha_ingreso: fComp.fecha_ingreso || null
    }
    const { error } = await supabase.from('componentes').insert(payload)
    if (error) setMsg('❌ ' + error.message)
    else {
      setMsg('✅ Componente guardado')
      setFComp({ tipo_componente_id:'', codigo:'', serie:'', estado_componente_id:'', fecha_ingreso:'' })
      loadComponentes()
    }
  }

  // ====== Montaje / Desmontaje ======
  const montar = async () => {
    setMsg('')
    if (!isAdminOrOficina) return setMsg('Solo admin/oficina pueden montar')
    const { componente_id, equipo_id, fecha_inicio } = fMontaje
    if (!componente_id || !equipo_id || !fecha_inicio) return setMsg('Completa componente, equipo y fecha inicio')

    // 1) validar que el componente no esté montado
    if (montajesActivos.some(m => m.componente_id === componente_id)) {
      return setMsg('El componente ya está montado. Desmonta primero.')
    }
    // 2) validar que el equipo no tenga un componente activo del mismo tipo (para tipos críticos)
    const comp = componentes.find(c=>c.id===componente_id)
    const compTipoId = comp?.tipo_componente_id
    const activosEquipo = montajesActivos.filter(m => m.equipo_id === equipo_id)
    const compIdsEquipo = new Set(activosEquipo.map(m=>m.componente_id))
    const compsEquipo = componentes.filter(c => compIdsEquipo.has(c.id))
    const tiposCriticos = new Set(
      tipos
        .filter(t => ['rov','umbilical','controlador'].includes(String(t.codigo || '').toLowerCase()))
        .map(t => t.id)
    )
    if (tiposCriticos.has(compTipoId)) {
      const yaHayMismoTipo = compsEquipo.some(c => c.tipo_componente_id === compTipoId)
      if (yaHayMismoTipo) return setMsg('Ese equipo ya tiene un componente activo de ese tipo')
    }

    // es_opcional para sensor/grabber
    const isOptional = ['sensor','grabber'].includes(String(tipoById(compTipoId)?.codigo || '').toLowerCase())

    const { error } = await supabase.from('equipo_componente').insert({
      componente_id, equipo_id, fecha_inicio, es_opcional: isOptional
    })
    if (error) setMsg('❌ ' + error.message)
    else {
      setMsg('✅ Montado')
      setFMontaje({ componente_id:'', equipo_id:'', fecha_inicio:'', fecha_fin:'' })
      loadMontajesActivos()
    }
  }

  const desmontar = async () => {
    setMsg('')
    if (!isAdminOrOficina) return setMsg('Solo admin/oficina pueden desmontar')
    const { componente_id, fecha_fin } = fMontaje
    if (!componente_id || !fecha_fin) return setMsg('Selecciona componente y fecha fin')
    // cerrar el montaje activo
    const activo = montajesActivos.find(m => m.componente_id === componente_id)
    if (!activo) return setMsg('Ese componente no está montado')

    const { error } = await supabase
      .from('equipo_componente')
      .update({ fecha_fin })
      .eq('componente_id', componente_id)
      .is('fecha_fin', null)
    if (error) setMsg('❌ ' + error.message)
    else {
      setMsg('✅ Desmontado')
      setFMontaje({ componente_id:'', equipo_id:'', fecha_inicio:'', fecha_fin:'' })
      loadMontajesActivos()
    }
  }

  // ====== Lista con búsqueda ======
  const lista = useMemo(() => {
    const qn = q.trim().toLowerCase()
    if (!qn) return componentes
    return componentes.filter(c => {
      const t = tipoById(c.tipo_componente_id)?.nombre || ''
      const cod = c.codigo || ''
      const ser = c.serie || ''
      return [t, cod, ser].some(v => String(v).toLowerCase().includes(qn))
    })
  }, [q, componentes, tipos])

  const equipoActual = (compId) => {
    const m = montajesActivos.find(x => x.componente_id === compId)
    if (!m) return ''
    return equipoById(m.equipo_id)?.codigo || `(equipo ${m.equipo_id})`
  }

  // ====== UI ======
  return (
    <div>
      <h2>Inventario</h2>

      {/* Alta de componente */}
      <section style={box}>
        <h3>Agregar componente</h3>
        <div style={row}>
          <select style={inp} value={fComp.tipo_componente_id} onChange={e=>setFComp(v=>({...v, tipo_componente_id:e.target.value}))}>
            <option value="">Tipo…</option>
            {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre} ({t.codigo})</option>)}
          </select>
          <input style={inp} placeholder="Código (único por tipo)" value={fComp.codigo}
                 onChange={e=>setFComp(v=>({...v, codigo:e.target.value}))}/>
          <input style={inp} placeholder="Serie (opcional)" value={fComp.serie}
                 onChange={e=>setFComp(v=>({...v, serie:e.target.value}))}/>
          <select style={inp} value={fComp.estado_componente_id} onChange={e=>setFComp(v=>({...v, estado_componente_id:e.target.value}))}>
            <option value="">Estado…</option>
            {estados.map(t => <option key={t.id} value={t.id}>{t.nombre} ({t.codigo})</option>)}
          </select>
          <input type="date" style={inp} value={fComp.fecha_ingreso}
                 onChange={e=>setFComp(v=>({...v, fecha_ingreso:e.target.value}))}/>
          <button style={btn} onClick={guardarComponente} disabled={!isAdminOrOficina}>Guardar</button>
        </div>
        <p>{msg}</p>
      </section>

      {/* Montaje / Desmontaje */}
      <section style={box}>
        <h3>Montaje / Desmontaje</h3>
        <div style={row}>
          <select style={inp} value={fMontaje.componente_id} onChange={e=>setFMontaje(v=>({...v, componente_id:e.target.value}))}>
            <option value="">Componente…</option>
            {componentes.map(c => (
              <option key={c.id} value={c.id}>
                {tipoById(c.tipo_componente_id)?.codigo?.toUpperCase()} · {c.codigo} {c.serie ? `· ${c.serie}`:''}
                {montajesActivos.some(m=>m.componente_id===c.id) ? ' · (MONTADO)' : ''}
              </option>
            ))}
          </select>

          <select style={inp} value={fMontaje.equipo_id} onChange={e=>setFMontaje(v=>({...v, equipo_id:e.target.value}))}>
            <option value="">Equipo…</option>
            {equipos.map(e => <option key={e.id} value={e.id}>{e.codigo}</option>)}
          </select>

          <input type="date" style={inp} value={fMontaje.fecha_inicio}
                 onChange={e=>setFMontaje(v=>({...v, fecha_inicio:e.target.value}))}/>
          <button style={btn} onClick={montar} disabled={!isAdminOrOficina}>Montar</button>

          <input type="date" style={inp} value={fMontaje.fecha_fin}
                 onChange={e=>setFMontaje(v=>({...v, fecha_fin:e.target.value}))}/>
          <button style={btn} onClick={desmontar} disabled={!isAdminOrOficina}>Desmontar</button>
        </div>
      </section>

      {/* Lista buscable */}
      <section style={box}>
        <h3>Componentes</h3>
        <div style={row}>
          <input style={inp} placeholder="Buscar (tipo/código/serie)..." value={q} onChange={e=>setQ(e.target.value)}/>
        </div>

        <table style={tbl}>
          <thead>
            <tr>
              <th style={thtd}>Tipo</th>
              <th style={thtd}>Código</th>
              <th style={thtd}>Serie</th>
              <th style={thtd}>Estado</th>
              <th style={thtd}>Ingreso</th>
              <th style={thtd}>Equipo actual</th>
              <th style={thtd}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.id}>
                <td style={thtd}>{tipoById(c.tipo_componente_id)?.nombre || c.tipo_componente_id}</td>
                <td style={thtd}>{c.codigo}</td>
                <td style={thtd}>{c.serie || '—'}</td>
                <td style={thtd}>{estadoById(c.estado_componente_id)?.nombre || c.estado_componente_id}</td>
                <td style={thtd}>{c.fecha_ingreso || '—'}</td>
                <td style={thtd}>{equipoActual(c.id) || 'Libre'}</td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>setFMontaje(v=>({...v, componente_id:c.id}))}>Montar…</button>
                </td>
              </tr>
            ))}
            {!lista.length && (
              <tr><td style={thtd} colSpan={7}>Sin componentes</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
