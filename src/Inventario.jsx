import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

const box  = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:1200 }
const row  = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn  = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer', background:'#fff' }
const input= { padding:8, border:'1px solid #bbb', borderRadius:8, background:'#fff' }
const tbl  = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 6px', textAlign:'left' }
const tag  = (ok, text) => <span style={{padding:'2px 8px', borderRadius:999, fontSize:12, border:'1px solid #cfe9dc', background: ok?'#e6f6ed':'#fde8e8'}}>{text}</span>

export default function Inventario() {
  // catálogos
  const [tipos, setTipos] = useState([])
  const [estados, setEstados] = useState([])
  const [equipos, setEquipos] = useState([])
  const [componentes, setComponentes] = useState([]) // desde vista v_componente_ubicacion_actual
  const [equiposResumen, setEquiposResumen] = useState([])

  // alta componente
  const [tipoSel, setTipoSel] = useState('')
  const [serie, setSerie] = useState('')
  const [codigo, setCodigo] = useState('')
  const [estadoSel, setEstadoSel] = useState('')
  const [fechaIng, setFechaIng] = useState('')

  // ensamblar / desarmar
  const [compSel, setCompSel] = useState('')
  const [equipoSel, setEquipoSel] = useState('')
  const [fEns, setFEns] = useState('')
  const [fDes, setFDes] = useState('')
  const [msg, setMsg] = useState('')

  const [q, setQ] = useState('')

  // ====== carga ======
  const loadCatalogos = async () => {
    const [{ data: t }, { data: e }] = await Promise.all([
      supabase.from('tipo_componente').select('id, nombre, codigo').order('nombre'),
      supabase.from('estado_componente').select('id, nombre').order('nombre'),
    ])
    setTipos(t || []); setEstados(e || [])
  }

  const loadEquipos = async () => {
    const { data } = await supabase.from('equipos').select('id, codigo').order('codigo')
    setEquipos(data || [])
  }

  const loadComponentes = async () => {
    const { data, error } = await supabase
      .from('v_componente_ubicacion_actual')
      .select('*')
      .order('tipo', { ascending: true })
      .order('codigo', { ascending: true })
    if (error) setMsg('❌ '+error.message)
    setComponentes(data || [])
  }

  const loadEquiposResumen = async () => {
    const { data, error } = await supabase
      .from('v_equipo_resumen_actual')
      .select('*')
      .order('equipo_codigo')
    if (error) setMsg('❌ '+error.message)
    setEquiposResumen(data || [])
  }

  useEffect(() => { loadCatalogos(); loadEquipos(); loadComponentes(); loadEquiposResumen() }, [])

  // ====== helpers ======
  const autogeneraCodigo = (tipoCodigo) => {
    // ejemplo: ROV-0001, CTR-0001, UBM-0001, SNS-0001, GRB-0001
    // busca máximo existente del prefijo y suma 1 (simple client-side; válido si 1 admin)
    const pref = (tipoCodigo || '').toUpperCase().slice(0,3)
    const existentes = (componentes || [])
      .filter(c => (c.codigo || '').startsWith(pref + '-'))
      .map(c => parseInt((c.codigo || '0').split('-')[1] || '0', 10))
      .filter(n => !Number.isNaN(n))
    const next = (existentes.length ? Math.max(...existentes) + 1 : 1)
    return `${pref}-${String(next).padStart(4,'0')}`
  }

  // ====== acciones ======
  const crear = async () => {
    setMsg('')
    if (!tipoSel || !serie || !estadoSel) return setMsg('Completa tipo, serie y estado.')
    const tipoRow = tipos.find(t => t.id === tipoSel)
    const cod = codigo?.trim() || autogeneraCodigo(tipoRow?.codigo || tipoRow?.nombre || 'CMP')

    const { error } = await supabase
      .from('componentes')
      .insert([{
        tipo_componente_id: tipoSel,
        estado_componente_id: estadoSel,
        fecha_ingreso: fechaIng || null,
        serie: serie.trim(),
        codigo: cod
      }])
    if (error) return setMsg('❌ '+error.message)

    setTipoSel(''); setSerie(''); setCodigo(''); setEstadoSel(''); setFechaIng('')
    await loadComponentes()
    setMsg('✅ Componente agregado')
  }

  const ensamblar = async () => {
    setMsg('')
    if (!compSel || !equipoSel) return setMsg('Elige componente y equipo')
    // 1) cerrar bodega abierta (si existe)
    await supabase.rpc('fn_componente_bodega_cerrar', { p_componente_id: compSel, p_fecha: fEns || null })
    // 2) asociar al equipo
    const { error } = await supabase
      .from('equipo_componente')
      .insert([{ equipo_id: equipoSel, componente_id: compSel, fecha_inicio: fEns || null }])
    if (error) return setMsg('❌ '+error.message)
    await Promise.all([loadComponentes(), loadEquiposResumen()])
    setMsg('✅ Ensamblado')
  }

  const desarmar = async () => {
    setMsg('')
    if (!compSel) return setMsg('Elige el componente a desarmar')

    // buscamos dónde está armado para conocer el centro
    const comp = componentes.find(c => c.componente_id === compSel)
    // 1) cerrar relación equipo_componente actual
    const { error } = await supabase
      .from('equipo_componente')
      .update({ fecha_fin: fDes || new Date().toISOString().slice(0,10) })
      .eq('componente_id', compSel)
      .is('fecha_fin', null)
    if (error) return setMsg('❌ '+error.message)

    // 2) abrir bodega en el centro actual del equipo (si lo sabemos)
    if (comp?.centro) {
      // Nota: para esto necesitaríamos el id del centro. Si quieres exactitud 100%,
      // agrega centro_id a la vista v_componente_ubicacion_actual y úsalo aquí.
      // Por ahora dejamos solo el cierre de equipo; la UI seguirá mostrando "reserva/bodega" cuando lo setees.
    }

    await Promise.all([loadComponentes(), loadEquiposResumen()])
    setMsg('✅ Desarmado')
  }

  // ====== filtros ======
  const componentesFiltrados = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return componentes
    return (componentes || []).filter(c =>
      [c.tipo, c.codigo, c.serie, c.estado, c.centro, c.equipo_codigo]
        .some(v => String(v||'').toLowerCase().includes(qq))
    )
  }, [q, componentes])

  return (
    <div>
      {/* Alta componente */}
      <section style={box}>
        <h3>Agregar componente</h3>
        <div style={row}>
          <select style={input} value={tipoSel} onChange={e=>setTipoSel(e.target.value)}>
            <option value="">Tipo...</option>
            {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>

          <input style={input} placeholder="Serie (fábrica) — obligatoria" value={serie} onChange={e=>setSerie(e.target.value)} />
          <input style={input} placeholder="Código (opcional, autogenerado)" value={codigo} onChange={e=>setCodigo(e.target.value)} />

          <select style={input} value={estadoSel} onChange={e=>setEstadoSel(e.target.value)}>
            <option value="">Estado...</option>
            {estados.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>

          <input style={input} type="date" value={fechaIng} onChange={e=>setFechaIng(e.target.value)} />
          <button style={btn} onClick={crear}>Guardar</button>
        </div>
      </section>

      {/* Ensamblar / Desarmar */}
      <section style={box}>
        <h3>Ensamblar / Desarmar</h3>
        <div style={row}>
          <select style={input} value={compSel} onChange={e=>setCompSel(e.target.value)}>
            <option value="">Componente...</option>
            {componentes.map(c => (
              <option key={c.componente_id} value={c.componente_id}>
                {c.tipo} — {c.codigo || c.serie} ({c.ubic_tipo}{c.centro ? ` · ${c.centro}`:''}{c.equipo_codigo?` · ${c.equipo_codigo}`:''})
              </option>
            ))}
          </select>

          <select style={input} value={equipoSel} onChange={e=>setEquipoSel(e.target.value)}>
            <option value="">Equipo...</option>
            {equipos.map(e => <option key={e.id} value={e.id}>{e.codigo}</option>)}
          </select>

          <input style={input} type="date" value={fEns} onChange={e=>setFEns(e.target.value)} />
          <button style={btn} onClick={ensamblar}>Ensamblar</button>

          <input style={input} type="date" value={fDes} onChange={e=>setFDes(e.target.value)} />
          <button style={btn} onClick={desarmar}>Desarmar</button>
        </div>
      </section>

      {/* Componentes */}
      <section style={box}>
        <h3>Componentes</h3>
        <div style={row}>
          <input style={input} placeholder="Buscar (tipo/código/serie/centro/equipo)..." value={q} onChange={e=>setQ(e.target.value)} />
          <button style={btn} onClick={loadComponentes}>Refrescar</button>
        </div>

        <table style={tbl}>
          <thead>
            <tr>
              <th style={thtd}>Tipo</th>
              <th style={thtd}>Código</th>
              <th style={thtd}>Serie</th>
              <th style={thtd}>Estado</th>
              <th style={thtd}>Ingreso</th>
              <th style={thtd}>Ubicación</th>  {/* NUEVA */}
              <th style={thtd}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {componentesFiltrados.map(c => (
              <tr key={c.componente_id}>
                <td style={thtd}>{c.tipo}</td>
                <td style={thtd}>{c.codigo}</td>
                <td style={thtd}>{c.serie}</td>
                <td style={thtd}>{c.estado}</td>
                <td style={thtd}>{c.fecha_ingreso || ''}</td>
                <td style={thtd}>
                  {c.ubic_tipo === 'equipo' && (<span>{c.centro} — <b>{c.equipo_codigo}</b></span>)}
                  {c.ubic_tipo === 'bodega' && (<span>{c.centro} — Bodega</span>)}
                  {c.ubic_tipo === 'reserva' && (<span>Reserva</span>)}
                </td>
                <td style={thtd}>
                  {/* Atajo para ensamblar desde la tabla */}
                  <button style={btn} onClick={()=>{ setCompSel(c.componente_id); }}>Ensamblar…</button>
                </td>
              </tr>
            ))}
            {!componentesFiltrados.length && (
              <tr><td style={thtd} colSpan={7}>Sin registros</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Equipos formados */}
      <section style={box}>
        <h3>Equipos formados</h3>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={thtd}>Equipo</th>
              <th style={thtd}>Centro</th>
              <th style={thtd}>ROV</th>
              <th style={thtd}>CTRL</th>
              <th style={thtd}>UMB</th>
              <th style={thtd}>Grabber</th>
              <th style={thtd}>Sensores</th>
              <th style={thtd}>Estado</th>
              <th style={thtd}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {equiposResumen.map(r => (
              <tr key={r.equipo_id}>
                <td style={thtd}>{r.equipo_codigo}</td>
                <td style={thtd}>{r.centro || '—'}</td>
                <td style={thtd}>{r.rov_codigo || '—'}</td>
                <td style={thtd}>{r.ctrl_codigo || '—'}</td>
                <td style={thtd}>{r.umb_codigo || '—'}</td>
                <td style={thtd}>{r.grabber_codigo || '—'}</td>
                <td style={thtd}>{r.sensores || 0}</td>
                <td style={thtd}>
                  {tag(r.core_completo, r.core_completo ? 'Core completo' : 'Incompleto')}
                  {' '}
                  {tag(r.rov_ctrl_pareados, r.rov_ctrl_pareados ? 'Pareados' : 'No pareados')}
                </td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>alert('(WIP) Abrir detalle de equipo')} >Ver</button>
                </td>
              </tr>
            ))}
            {!equiposResumen.length && (
              <tr><td style={thtd} colSpan={9}>Sin equipos</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {!!msg && <p style={{marginTop:8}}>{msg}</p>}
    </div>
  )
}

