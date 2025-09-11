import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

/* ====== estilos simples ====== */
const box  = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:1200 }
const row  = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn  = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer', background:'#fff' }
const input= { padding:8, border:'1px solid #bbb', borderRadius:8, background:'#fff' }
const tbl  = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 6px', textAlign:'left', verticalAlign:'top' }
const Chip = ({ok, children}) => (
  <span style={{
    padding:'2px 8px', borderRadius:999, fontSize:12,
    border:'1px solid #cfe9dc',
    background: ok ? '#e6f6ed' : '#fde8e8'
  }}>{children}</span>
)

/* ====== util código autogenerado ====== */
const tipoToPref = (nombre) => {
  if (!nombre) return 'CMP'
  const n = nombre.toUpperCase()
  if (n.startsWith('CONTROL')) return 'CTR'
  if (n.startsWith('UMBIL')) return 'UMB'
  if (n.startsWith('SENSOR')) return 'SNS'
  if (n.startsWith('GRAB')) return 'GRB'
  return n.slice(0,3) // ROV, etc.
}

export default function Inventario() {
  /* ===== catálogos y datos ===== */
  const [tipos, setTipos] = useState([])
  const [estados, setEstados] = useState([])
  const [equipos, setEquipos] = useState([])
  // componentes desde vista de ubicación actual
  const [componentes, setComponentes] = useState([])
  // equipos formados
  const [equiposResumen, setEquiposResumen] = useState([])

  /* ===== alta componente ===== */
  const [tipoSel, setTipoSel] = useState('')
  const [serie, setSerie] = useState('')
  const [codigo, setCodigo] = useState('')
  const [estadoSel, setEstadoSel] = useState('')
  const [fechaIng, setFechaIng] = useState('')

  // bodega inicial (opcional)
  const [empresas, setEmpresas] = useState([])
  const [empresaCr, setEmpresaCr] = useState('')
  const [zonaCr, setZonaCr] = useState('')
  const [centroCr, setCentroCr] = useState('')
  const [zonasCr, setZonasCr] = useState([])
  const [centrosCr, setCentrosCr] = useState([])

  /* ===== ensamblar / desarmar rápidos ===== */
  const [compSel, setCompSel] = useState('')
  const [equipoSel, setEquipoSel] = useState('')
  const [fEns, setFEns] = useState('')
  const [fDes, setFDes] = useState('')

  /* ===== detalle de equipo ===== */
  const [equipoOpen, setEquipoOpen] = useState(null) // {id, codigo, centro_id, centro, comps:[]}

  /* ===== búsqueda/mensajes ===== */
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')

  /* ====== carga inicial ====== */
  const loadCatalogos = async () => {
    const [{ data: t }, { data: e }] = await Promise.all([
      supabase.from('tipo_componente').select('id, nombre').order('nombre'),
      supabase.from('estado_componente').select('id, nombre').order('nombre'),
    ])
    setTipos(t || []); setEstados(e || [])
  }
  const loadEmpresas = async () => {
    const { data } = await supabase.from('empresas').select('id, nombre').order('nombre')
    setEmpresas(data || [])
  }
  const fetchZonas = async (empresaId) => {
    const { data } = await supabase.from('zonas').select('id, nombre').eq('empresa_id', empresaId).order('nombre')
    return data || []
  }
  const fetchCentros = async (zonaId) => {
    const { data } = await supabase.from('centros').select('id, nombre').eq('zona_id', zonaId).order('nombre')
    return data || []
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
    if (error) setMsg('❌ ' + error.message)
    setComponentes(data || [])
  }
  const loadEquiposResumen = async () => {
    const { data, error } = await supabase
      .from('v_equipo_resumen_actual')
      .select('*')
      .order('equipo_codigo')
    if (error) setMsg('❌ ' + error.message)
    setEquiposResumen(data || [])
  }

  useEffect(() => {
    loadCatalogos(); loadEmpresas(); loadEquipos(); loadComponentes(); loadEquiposResumen()
  }, [])

  /* ====== dependencias bodega inicial ====== */
  useEffect(() => { (async() => {
    if (empresaCr) {
      setZonasCr(await fetchZonas(empresaCr))
      setZonaCr(''); setCentrosCr([]); setCentroCr('')
    } else {
      setZonasCr([]); setZonaCr(''); setCentrosCr([]); setCentroCr('')
    }
  })() }, [empresaCr])

  useEffect(() => { (async() => {
    if (zonaCr) {
      setCentrosCr(await fetchCentros(zonaCr))
      setCentroCr('')
    } else {
      setCentrosCr([]); setCentroCr('')
    }
  })() }, [zonaCr])

  /* ====== helpers ====== */
  const autogeneraCodigo = () => {
    const t = tipos.find(x => x.id === tipoSel)
    const pref = tipoToPref(t?.nombre)
    const existentes = (componentes || [])
      .filter(c => (c.tipo || '').toUpperCase().startsWith((t?.nombre||'').toUpperCase()))
      .map(c => {
        const m = String(c.codigo || '').split('-')[1]
        const n = parseInt(m || '0', 10)
        return Number.isNaN(n) ? 0 : n
      })
    const next = (existentes.length ? Math.max(...existentes) + 1 : 1)
    return `${pref}-${String(next).padStart(4, '0')}`
  }

  /* ====== acciones alta/ensamble ====== */
  const crear = async () => {
    setMsg('')
    if (!tipoSel || !serie.trim() || !estadoSel) {
      return setMsg('Completa Tipo, Serie y Estado.')
    }
    const cod = (codigo || '').trim() || autogeneraCodigo()
    const insert = {
      tipo_componente_id: tipoSel,
      estado_componente_id: estadoSel,
      fecha_ingreso: fechaIng || null,
      serie: serie.trim(),
      codigo: cod
    }

    const { data: inserted, error } = await supabase
      .from('componentes')
      .insert([insert])
      .select('id')
      .single()
    if (error) return setMsg('❌ ' + error.message)

    // Si se seleccionó centro de bodega, crear ubicación inicial
    if (centroCr) {
      await supabase.rpc('fn_componente_bodega_set', {
        p_componente_id: inserted.id,
        p_centro_id: centroCr,
        p_fecha: fechaIng || null
      })
    }

    setTipoSel(''); setSerie(''); setCodigo(''); setEstadoSel(''); setFechaIng('')
    setEmpresaCr(''); setZonaCr(''); setCentroCr(''); setZonasCr([]); setCentrosCr([])
    await loadComponentes()
    setMsg('✅ Componente agregado')
  }

  const ensamblar = async () => {
    setMsg('')
    if (!compSel || !equipoSel) return setMsg('Elige componente y equipo')
    const { error } = await supabase.rpc('rpc_ensamblar_componente', {
      p_equipo_id: equipoSel, p_componente_id: compSel, p_fecha: fEns || null
    })
    if (error) return setMsg('❌ ' + error.message)
    setCompSel(''); setEquipoSel(''); setFEns('')
    await Promise.all([loadComponentes(), loadEquiposResumen()])
    if (equipoOpen) await openEquipo(equipoOpen.id, equipoOpen.codigo)
    setMsg('✅ Ensamblado')
  }

  const desarmar = async () => {
    setMsg('')
    if (!compSel || !equipoSel) return setMsg('Elige componente y equipo para desarmar')
    const { error } = await supabase.rpc('rpc_desarmar_componente', {
      p_equipo_id: equipoSel, p_componente_id: compSel, p_fecha: fDes || null
    })
    if (error) return setMsg('❌ ' + error.message)
    setCompSel(''); setEquipoSel(''); setFDes('')
    await Promise.all([loadComponentes(), loadEquiposResumen()])
    if (equipoOpen) await openEquipo(equipoOpen.id, equipoOpen.codigo)
    setMsg('✅ Desarmado')
  }

  /* ===== detalle de equipo ===== */
  const openEquipo = async (equipoId, equipoCodigo) => {
    const { data: cRow } = await supabase
      .from('v_equipo_centro_actual')
      .select('centro_id, centro')
      .eq('equipo_id', equipoId)
      .maybeSingle()

    const { data: det } = await supabase
      .from('v_equipo_detalle_actual')
      .select('tipo, componente_id, comp_codigo, comp_serie')
      .eq('equipo_id', equipoId)

    setEquipoOpen({
      id: equipoId,
      codigo: equipoCodigo,
      centro_id: cRow?.centro_id || null,
      centro: cRow?.centro || '—',
      comps: det || []
    })
  }
  const closeEquipo = () => setEquipoOpen(null)

  /* ===== filtros ===== */
  const componentesFiltrados = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return componentes
    return (componentes || []).filter(c =>
      [c.tipo, c.codigo, c.serie, c.estado, c.centro, c.equipo_codigo, c.ubic_tipo]
        .some(v => String(v||'').toLowerCase().includes(qq))
    )
  }, [q, componentes])

  /* ===== UI ===== */
  return (
    <div>
      {/* Alta componente */}
      <section style={box}>
        <h3>Agregar componente</h3>
        <div style={row}>
          <select style={input} value={tipoSel} onChange={e=>setTipoSel(e.target.value)}>
            <option value="">Tipo…</option>
            {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>

          <input style={input} placeholder="Serie (fábrica) — obligatoria" value={serie} onChange={e=>setSerie(e.target.value)} />
          <input style={input} placeholder="Código (opcional, autogenerado)" value={codigo} onChange={e=>setCodigo(e.target.value)} />

          <select style={input} value={estadoSel} onChange={e=>setEstadoSel(e.target.value)}>
            <option value="">Estado…</option>
            {estados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>

          <input style={input} type="date" value={fechaIng} onChange={e=>setFechaIng(e.target.value)} />

          {/* Bodega inicial opcional */}
          <select style={input} value={empresaCr} onChange={e=>setEmpresaCr(e.target.value)}>
            <option value="">(empresa — bodega)</option>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <select style={input} value={zonaCr} onChange={e=>setZonaCr(e.target.value)} disabled={!empresaCr}>
            <option value="">(zona)</option>
            {zonasCr.map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
          <select style={input} value={centroCr} onChange={e=>setCentroCr(e.target.value)} disabled={!zonaCr}>
            <option value="">(centro bodega — opcional)</option>
            {centrosCr.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>

          <button style={btn} onClick={crear}>Guardar</button>
        </div>
      </section>

      {/* Ensamblar / Desarmar rápidos */}
      <section style={box}>
        <h3>Ensamblar / Desarmar</h3>
        <div style={row}>
          <select style={input} value={compSel} onChange={e=>setCompSel(e.target.value)}>
            <option value="">Componente…</option>
            {componentes.map(c => (
              <option key={c.componente_id} value={c.componente_id}>
                {c.tipo} — {c.codigo || c.serie} ({c.ubic_tipo}{c.centro ? ` · ${c.centro}`:''}{c.equipo_codigo ? ` · ${c.equipo_codigo}`:''})
              </option>
            ))}
          </select>

          <select style={input} value={equipoSel} onChange={e=>setEquipoSel(e.target.value)}>
            <option value="">Equipo…</option>
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
          <input style={input} placeholder="Buscar (tipo/código/serie/centro/equipo)…" value={q} onChange={e=>setQ(e.target.value)} />
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
              <th style={thtd}>Ubicación</th>
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
                  {c.ubic_tipo === 'equipo'   && (<span>{c.centro} — <b>{c.equipo_codigo}</b></span>)}
                  {c.ubic_tipo === 'bodega'   && (<span>{c.centro} — Bodega</span>)}
                  {c.ubic_tipo === 'transito' && (<span>En tránsito → {c.centro}</span>)}
                  {c.ubic_tipo === 'reserva'  && (<span>Reserva</span>)}
                </td>
                <td style={thtd}>
                  <button style={btn} onClick={()=> setCompSel(c.componente_id)}>Ensamblar…</button>
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
                  <Chip ok={!!r.core_completo}>{r.core_completo ? 'Core completo' : 'Incompleto'}</Chip>
                  {' '}
                  <Chip ok={!!r.rov_ctrl_pareados}>{r.rov_ctrl_pareados ? 'Pareados' : 'No pareados'}</Chip>
                </td>
                <td style={thtd}>
                  <button style={btn} onClick={()=>openEquipo(r.equipo_id, r.equipo_codigo)}>Ver</button>
                </td>
              </tr>
            ))}
            {!equiposResumen.length && (
              <tr><td style={thtd} colSpan={9}>Sin equipos</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Detalle de equipo */}
      {equipoOpen && (
        <section style={box}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h3>Equipo {equipoOpen.codigo} — {equipoOpen.centro}</h3>
            <button style={btn} onClick={closeEquipo}>Cerrar</button>
          </div>

          <table style={tbl}>
            <thead>
              <tr>
                <th style={thtd}>Tipo</th>
                <th style={thtd}>Código</th>
                <th style={thtd}>Serie</th>
                <th style={thtd}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {equipoOpen.comps.map(x => (
                <tr key={x.componente_id}>
                  <td style={thtd}>{x.tipo}</td>
                  <td style={thtd}>{x.comp_codigo || '—'}</td>
                  <td style={thtd}>{x.comp_serie || '—'}</td>
                  <td style={thtd}>
                    <button
                      style={btn}
                      onClick={async ()=>{
                        const { error } = await supabase.rpc('rpc_desarmar_componente', {
                          p_equipo_id: equipoOpen.id,
                          p_componente_id: x.componente_id,
                          p_fecha: null
                        })
                        if (error) setMsg('❌ ' + error.message)
                        else {
                          await Promise.all([loadComponentes(), loadEquiposResumen()])
                          await openEquipo(equipoOpen.id, equipoOpen.codigo)
                          setMsg('✅ Desarmado')
                        }
                      }}
                    >Desarmar</button>
                  </td>
                </tr>
              ))}
              {!equipoOpen.comps.length && (
                <tr><td style={thtd} colSpan={4}>Sin componentes</td></tr>
              )}
            </tbody>
          </table>

          <div style={{marginTop:12}}>
            <h4>Ensamblar desde bodega del centro</h4>
            <div style={row}>
              <select
                style={input}
                value={compSel}
                onChange={e=>setCompSel(e.target.value)}
              >
                <option value="">Componente (en bodega {equipoOpen.centro})…</option>
                {componentes
                  .filter(c => c.ubic_tipo === 'bodega' && c.centro === equipoOpen.centro)
                  .map(c => (
                    <option key={c.componente_id} value={c.componente_id}>
                      {c.tipo} — {c.codigo || c.serie}
                    </option>
                  ))
                }
              </select>
              <button
                style={btn}
                onClick={async ()=>{
                  if (!compSel) return setMsg('Elige un componente')
                  const { error } = await supabase.rpc('rpc_ensamblar_componente', {
                    p_equipo_id: equipoOpen.id,
                    p_componente_id: compSel,
                    p_fecha: null
                  })
                  if (error) setMsg('❌ ' + error.message)
                  else {
                    setCompSel('')
                    await Promise.all([loadComponentes(), loadEquiposResumen()])
                    await openEquipo(equipoOpen.id, equipoOpen.codigo)
                    setMsg('✅ Ensamblado')
                  }
                }}
              >Ensamblar</button>
            </div>
          </div>
        </section>
      )}

      {!!msg && <p style={{marginTop:8}}>{msg}</p>}
    </div>
  )
}

