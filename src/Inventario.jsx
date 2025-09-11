// Inventario.jsx — Vista ampliada (Oficina/Centro)
// -------------------------------------------------
// Características:
// 1) Columna de "Ubicación" en Componentes (Bodega / Equipo / Tránsito / Reserva)
// 2) Vista de Equipos completos con componentes actuales
// 3) Modal para "Ensamblar" (agregar componente) con validación de compatibilidad
// 4) NUEVO: Crear equipos (autocódigo EQP-####) y asignación inicial opcional por RPC
// 5) NUEVO: Detalle de equipo + botón "Desarmar" por componente
// 6) Búsqueda simple en ambas pestañas
//
// Requisitos previos:
// - Supabase con tablas: componentes, equipos, equipo_componente, equipo_asignacion, centros, tipo_componente, estado_componente
// - RPCs ya creados: rpc_equipo_crear, rpc_equipo_asignar (opcional), rpc_ensamblar_componente, rpc_desarmar_componente
// - RLS: lecturas abiertas; escrituras a través de RPC SECURITY DEFINER
// - React + Tailwind

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// 👉 Variables de entorno (Vercel)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function hasValidSupabaseEnv() {
  const badUrl = !SUPABASE_URL || SUPABASE_URL.includes('YOUR-PROJECT') || !SUPABASE_URL.startsWith('https://')
  const badKey = !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')
  return !(badUrl || badKey)
}

function humanizeError(err) {
  const msg = err?.message || String(err)
  if (msg.includes('Failed to fetch')) return 'No se pudo conectar a Supabase. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (Vercel).'
  return msg
}

const UNIQUE_ROLES = ['ROV', 'CONTROLADOR', 'UMBILICAL', 'GRABBER']
const OPTIONAL_ROLES = ['SENSOR']

// Utils ------------------------------------------------------------------
const cn = (...a) => a.filter(Boolean).join(' ')
const suffix = (code='') => (code.split('-')[1] || '').trim()

function roleFromTipo(tipoNombre = '') {
  const t = (tipoNombre || '').toLowerCase()
  if (t.includes('rov')) return 'ROV'
  if (t.includes('control')) return 'CONTROLADOR'
  if (t.includes('umbil')) return 'UMBILICAL'
  if (t.includes('sensor')) return 'SENSOR'
  if (t.includes('grab')) return 'GRABBER'
  return (tipoNombre || 'DESCONOCIDO').toUpperCase()
}

function guessUbicacion({ equipo }) {
  if (equipo?.centro?.nombre) return equipo.centro.nombre
  return 'Bodega'
}

// Fetchers ---------------------------------------------------------------
async function fetchPerfil() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { rol: 'oficina', centro_id: null }
  const { data, error } = await supabase
    .from('profiles')
    .select('rol, user_id')
    .eq('user_id', user.id)
    .single()
  if (error) return { rol: 'oficina', centro_id: null }

  // Centro actual vía vista (si existe en tu esquema)
  let centro_id = null, centro_nombre = null
  try {
    const { data: ubic } = await supabase
      .from('v_usuario_ubicacion_actual')
      .select('centro_id, centro')
      .eq('user_id', user.id)
      .maybeSingle()
    centro_id = ubic?.centro_id || null
    centro_nombre = ubic?.centro || null
  } catch {}

  return { rol: data?.rol || 'oficina', centro_id, centro_nombre }
}

async function fetchCentros() {
  const { data, error } = await supabase
    .from('centros')
    .select('id, nombre')
    .order('nombre', { ascending: true })
  if (error) throw error
  return data || []
}

async function fetchComponentes({ centro_id = null, rol = 'oficina' }) {
  const { data, error } = await supabase
    .from('componentes')
    .select(`
      id, codigo, serie,
      tipo:tipo_componente_id(nombre),
      estado:estado_componente_id(nombre),
      equipo_comp:equipo_componente!left(
        fecha_inicio, fecha_fin,
        equipo:equipo_id(
          id, codigo,
          asign:equipo_asignacion!left(fecha_inicio, fecha_fin, centro:centros(id, nombre))
        )
      )
    `)
  if (error) throw error

  const list = (data || []).map((row) => {
    const equipoVig = (row.equipo_comp || []).find(e => e.fecha_fin == null)?.equipo || null
    const asignVig = (equipoVig?.asign || []).find(a => a.fecha_fin == null) || null
    const centro = asignVig?.centro || null
    return {
      id: row.id,
      codigo: row.codigo,
      serie: row.serie,
      tipo: row?.tipo?.nombre || '-',
      role: roleFromTipo(row?.tipo?.nombre),
      estado: row?.estado?.nombre || '-',
      equipo: equipoVig ? { id: equipoVig.id, codigo: equipoVig.codigo, centro } : null,
      ubicacion: guessUbicacion({ equipo: equipoVig ? { centro } : null })
    }
  })

  // Filtro por centro (cliente) si rol es centro
  if (rol !== 'oficina' && centro_id) {
    return list.filter(r => !r.equipo || r.equipo?.centro?.id === centro_id)
  }
  return list
}

async function fetchEquipos({ centro_id = null, rol = 'oficina' }) {
  const { data, error } = await supabase
    .from('equipos')
    .select(`
      id, codigo,
      asign:equipo_asignacion!left(fecha_inicio, fecha_fin, centro:centros(id, nombre)),
      comps:equipo_componente!left(fecha_inicio, fecha_fin, componente:componentes(id, codigo, serie, tipo:tipo_componente_id(nombre)))
    `)
  if (error) throw error

  const mapped = (data || []).map(eq => {
    const asignVig = (eq.asign || []).find(a => a.fecha_fin == null)
    const centro = asignVig?.centro || null
    const componentes = (eq.comps || [])
      .filter(c => c.fecha_fin == null)
      .map(c => ({ id: c.componente?.id, codigo: c.componente?.codigo, serie: c.componente?.serie, role: roleFromTipo(c.componente?.tipo?.nombre) }))
    return { id: eq.id, codigo: eq.codigo, centro, componentes }
  })

  const filtered = (rol !== 'oficina' && centro_id)
    ? mapped.filter(e => e.centro?.id === centro_id)
    : mapped
  return filtered
}

async function fetchComponentesDisponiblesParaEquipo({ equipo }) {
  const { data, error } = await supabase
    .from('componentes')
    .select(`id, codigo, serie, tipo:tipo_componente_id(nombre), ec:equipo_componente!left(fecha_fin)`)
  if (error) throw error
  const sinEquipo = (data || []).filter(r => !r.ec?.some(x => x.fecha_fin == null))
  return sinEquipo.map(r => ({ id: r.id, codigo: r.codigo, serie: r.serie, role: roleFromTipo(r?.tipo?.nombre) }))
}

// Mutaciones (RPC) -------------------------------------------------------
async function rpcEnsamblar({ equipo_id, componente_id, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_ensamblar_componente', {
    p_equipo_id: equipo_id,
    p_componente_id: componente_id,
    p_fecha: fecha
  })
  if (error) throw error
  return data
}

async function rpcDesarmar({ equipo_id, componente_id, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_desarmar_componente', {
    p_equipo_id: equipo_id,
    p_componente_id: componente_id,
    p_fecha: fecha
  })
  if (error) throw error
  return data
}

async function rpcCrearEquipo({ codigo = '', centroId = null, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_equipo_crear', {
    p_codigo: codigo || null,
    p_centro_id: centroId || null,
    p_fecha: fecha || null,
  })
  if (error) throw error
  return data?.[0]
}

// Componentes UI ---------------------------------------------------------
function TabButton({ active, children, onClick }) {
  return (
    <button onClick={onClick} className={cn('px-4 py-2 text-sm font-medium rounded-2xl', active ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700')}>{children}</button>
  )
}

function Table({ columns = [], data = [], empty = 'Sin datos' }) {
  return (
    <div className="overflow-x-auto border border-zinc-700 rounded-2xl">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-900/60">
          <tr>{columns.map(col => (<th key={col.key} className="text-left px-3 py-2 font-semibold text-zinc-200 whitespace-nowrap">{col.header}</th>))}</tr>
        </thead>
        <tbody>
          {data.length === 0 && (<tr><td className="px-3 py-4 text-zinc-400" colSpan={columns.length}>{empty}</td></tr>)}
          {data.map((row, i) => (
            <tr key={row.id || i} className="odd:bg-zinc-900/30">
              {columns.map(col => (<td key={col.key} className="px-3 py-2 align-top text-zinc-100 whitespace-nowrap">{col.render ? col.render(row[col.key], row) : row[col.key]}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-3xl rounded-2xl bg-zinc-900 border border-zinc-700 shadow-xl">
        <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
          <h3 className="text-zinc-100 font-semibold">{title}</h3>
          <button onClick={onClose} className="text-zinc-300 hover:text-white">✕</button>
        </div>
        <div className="p-4 text-zinc-100">{children}</div>
        <div className="px-4 py-3 border-t border-zinc-700 flex gap-2 justify-end">{footer}</div>
      </div>
    </div>
  )
}

// Página principal -------------------------------------------------------
export default function Inventario() {
  const [perfil, setPerfil] = useState({ rol: 'oficina', centro_id: null })
  const [envOk] = useState(hasValidSupabaseEnv())
  const [tab, setTab] = useState('componentes')

  const [loading, setLoading] = useState(false)
  const [componentes, setComponentes] = useState([])
  const [equipos, setEquipos] = useState([])
  const [centros, setCentros] = useState([])

  // Búsqueda
  const [qComp, setQComp] = useState('')
  const [qEq, setQEq] = useState('')

  // Modal Ensamblar
  const [modalOpen, setModalOpen] = useState(false)
  const [modalEquipo, setModalEquipo] = useState(null)
  const [opcDisponibles, setOpcDisponibles] = useState([])
  const [selectedComp, setSelectedComp] = useState(null)

  // Modal Crear equipo
  const [openCrear, setOpenCrear] = useState(false)
  const [codigoManual, setCodigoManual] = useState('')
  const [centroSel, setCentroSel] = useState('')

  // Modal Detalle equipo
  const [openDetalle, setOpenDetalle] = useState(false)
  const [detalleEquipo, setDetalleEquipo] = useState(null)

  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => { (async () => { const p = await fetchPerfil(); setPerfil(p) })() }, [])
  useEffect(() => { if (perfil) refresh() }, [perfil?.rol, perfil?.centro_id])
  useEffect(() => { (async () => { try { const cs = await fetchCentros(); setCentros(cs) } catch {} })() }, [])

  async function refresh() {
    if (!envOk) { setErrorMsg('Configura variables NEXT_PUBLIC_SUPABASE_URL/ANON_KEY.'); return }
    try {
      setLoading(true)
      const [c, e] = await Promise.all([
        fetchComponentes({ centro_id: perfil?.centro_id, rol: perfil?.rol }),
        fetchEquipos({ centro_id: perfil?.centro_id, rol: perfil?.rol })
      ])
      setComponentes(c)
      setEquipos(e)
    } catch (err) {
      setErrorMsg(humanizeError(err) || 'Error al cargar datos')
    } finally { setLoading(false) }
  }

  // Ensamblar ------------------------------------------------------------
  async function openModalEnsamblar(equipo) {
    setErrorMsg(''); setOkMsg(''); setSelectedComp(null)
    setModalEquipo(equipo); setModalOpen(true)
    try { const disp = await fetchComponentesDisponiblesParaEquipo({ equipo }); setOpcDisponibles(disp) } catch (e) { setErrorMsg(e.message) }
  }

  function canAddComponent(equipo, componente) {
    if (!equipo || !componente) return { ok: false, reason: 'Falta selección' }
    const role = componente.role
    const yaTiene = (equipo.componentes || []).filter(c => c.role === role)
    if (UNIQUE_ROLES.includes(role) && yaTiene.length > 0) return { ok: false, reason: `El equipo ya posee un ${role}` }
    return { ok: true }
  }

  async function handleEnsamblar() {
    if (!selectedComp || !modalEquipo) return
    const check = canAddComponent(modalEquipo, selectedComp)
    if (!check.ok) { setErrorMsg(check.reason); return }
    try {
      setSaving(true)
      await rpcEnsamblar({ equipo_id: modalEquipo.id, componente_id: selectedComp.id })
      setOkMsg('Componente ensamblado')
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setErrorMsg(humanizeError(err) || 'No se pudo ensamblar')
    } finally { setSaving(false) }
  }

  // Crear equipo ---------------------------------------------------------
  async function handleCrearEquipo() {
    try {
      setSaving(true)
      const centroId = perfil?.rol === 'centro' ? perfil?.centro_id : (centroSel || null)
      const res = await rpcCrearEquipo({ codigo: codigoManual.trim(), centroId })
      setOkMsg(`Equipo creado: ${res?.codigo || ''}`)
      setOpenCrear(false); setCodigoManual(''); setCentroSel('')
      await refresh()
    } catch (err) {
      setErrorMsg(humanizeError(err) || 'No se pudo crear el equipo')
    } finally { setSaving(false) }
  }

  // Detalle + Desarmar ---------------------------------------------------
  function openModalDetalle(equipo) { setDetalleEquipo(equipo); setOpenDetalle(true) }

  async function handleDesarmar(comp) {
    if (!detalleEquipo || !comp) return
    try {
      setSaving(true)
      await rpcDesarmar({ equipo_id: detalleEquipo.id, componente_id: comp.id })
      setOkMsg(`Desarmado: ${comp.codigo}`)
      setOpenDetalle(false)
      await refresh()
    } catch (err) {
      setErrorMsg(humanizeError(err) || 'No se pudo desarmar')
    } finally { setSaving(false) }
  }

  // Filtros de búsqueda --------------------------------------------------
  const compFiltrados = useMemo(() => {
    const q = qComp.trim().toLowerCase()
    if (!q) return componentes
    return componentes.filter(x =>
      (x.codigo||'').toLowerCase().includes(q) ||
      (x.tipo||'').toLowerCase().includes(q) ||
      (x.serie||'').toLowerCase().includes(q) ||
      (x.ubicacion||'').toLowerCase().includes(q)
    )
  }, [componentes, qComp])

  const equiposFiltrados = useMemo(() => {
    const q = qEq.trim().toLowerCase()
    if (!q) return equipos
    return equipos.filter(x =>
      (x.codigo||'').toLowerCase().includes(q) ||
      (x.centro?.nombre||'').toLowerCase().includes(q) ||
      (x.componentes||[]).some(c => (c.codigo||'').toLowerCase().includes(q) || (c.role||'').toLowerCase().includes(q))
    )
  }, [equipos, qEq])

  // Columnas -------------------------------------------------------------
  const colsComponentes = [
    { key: 'codigo', header: 'ID' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'serie', header: 'Serie' },
    { key: 'estado', header: 'Estado' },
    { key: 'ubicacion', header: 'Ubicación' },
    { key: 'equipo', header: 'Asignado a Equipo', render: (val) => val ? <span className="text-blue-300">{val.codigo}</span> : <span className="text-zinc-400">—</span> },
  ]

  const colsEquipos = [
    { key: 'codigo', header: 'Equipo' },
    { key: 'centro', header: 'Centro', render: (val) => val?.nombre || '—' },
    {
      key: 'estado', header: 'Estado',
      render: (_val, row) => {
        const roles = row.componentes?.map(c=>c.role) || []
        const coreOK = UNIQUE_ROLES.slice(0,3).every(r => roles.includes(r)) // ROV+CONTROLADOR+UMBILICAL
        const rov = row.componentes.find(c=>c.role==='ROV')
        const ctrl = row.componentes.find(c=>c.role==='CONTROLADOR')
        const pareados = rov && ctrl && suffix(rov.codigo) && suffix(rov.codigo) === suffix(ctrl.codigo)
        return (
          <div className="flex gap-2">
            <span className={cn('px-2 py-0.5 rounded text-xs', coreOK ? 'bg-emerald-700/30 text-emerald-200' : 'bg-zinc-700/40 text-zinc-200')}>{coreOK ? 'Core OK' : 'Core incompleto'}</span>
            <span className={cn('px-2 py-0.5 rounded text-xs', pareados ? 'bg-sky-700/30 text-sky-200' : 'bg-zinc-700/40 text-zinc-200')}>{pareados ? 'ROV/CTRL pareados' : 'No pareados'}</span>
          </div>
        )
      }
    },
    {
      key: 'acciones', header: 'Acciones',
      render: (_val, row) => (
        <div className="flex gap-2">
          <button onClick={() => openModalDetalle(row)} className="px-3 py-1 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Detalle</button>
          <button onClick={() => openModalEnsamblar(row)} className="px-3 py-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">Ensamblar</button>
        </div>
      )
    }
  ]

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Inventario</h1>
          <p className="text-sm text-zinc-400">Perfil: <b>{perfil?.rol || '—'}</b> {perfil?.centro_nombre ? `· Centro ${perfil.centro_nombre}` : ''}</p>
          {!envOk && (<p className="mt-2 text-xs text-amber-300">Modo instalación: faltan variables de entorno.</p>)}
        </div>
        <div className="flex gap-2">
          <TabButton active={tab==='componentes'} onClick={() => setTab('componentes')}>Componentes</TabButton>
          <TabButton active={tab==='equipos'} onClick={() => setTab('equipos')}>Equipos</TabButton>
          <button onClick={refresh} className="px-3 py-2 rounded-2xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Recargar</button>
        </div>
      </header>

      {errorMsg && (<div className="p-3 rounded-xl border border-red-700 bg-red-900/20 text-red-200">{errorMsg}</div>)}
      {okMsg && (<div className="p-3 rounded-xl border border-emerald-700 bg-emerald-900/20 text-emerald-200">{okMsg}</div>)}

      {tab === 'componentes' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">Componentes</h2>
            <input value={qComp} onChange={e=>setQComp(e.target.value)} placeholder="Buscar (código, tipo, serie, ubicación)" className="w-80 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
          </div>
          <Table columns={colsComponentes} data={compFiltrados} empty={loading ? 'Cargando…' : 'Sin componentes'} />
        </section>
      )}

      {tab === 'equipos' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">Equipos</h2>
            <div className="flex gap-2 items-center">
              <input value={qEq} onChange={e=>setQEq(e.target.value)} placeholder="Buscar (equipo, centro, componente)" className="w-80 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              <button onClick={() => setOpenCrear(true)} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Crear equipo</button>
            </div>
          </div>
          <Table columns={colsEquipos} data={equiposFiltrados} empty={loading ? 'Cargando…' : 'Sin equipos'} />
        </section>
      )}

      {/* Modal: Ensamblar */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Ensamblar en ${modalEquipo?.codigo || ''}`}
        footer={(
          <>
            <button onClick={() => setModalOpen(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
            <button onClick={handleEnsamblar} disabled={!selectedComp || saving} className={cn('px-3 py-2 rounded-xl text-white', (!selectedComp||saving)?'bg-zinc-700':'bg-emerald-600 hover:bg-emerald-500')}>
              {saving ? 'Ensamblando…' : 'Ensamblar'}
            </button>
          </>
        )}
      >
        {!modalEquipo ? (<p>Seleccione un equipo</p>) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-zinc-400">Centro del equipo: <b>{modalEquipo?.centro?.nombre || '—'}</b></p>
              <p className="text-sm text-zinc-400">Actual: {(modalEquipo?.componentes||[]).map(c=>`${c.role}:${c.codigo}`).join(', ') || '—'}</p>
              <p className="text-xs text-zinc-500">Nota: la BD valida centro/ubicación y evita duplicar ROV/CTRL/UMB/GRB.</p>
            </div>
            <div className="max-h-80 overflow-auto border border-zinc-700 rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Rol</th><th className="text-left px-3 py-2">ID</th><th className="text-left px-3 py-2">Serie</th><th className="text-left px-3 py-2">Acción</th></tr></thead>
                <tbody>
                  {(opcDisponibles||[]).length===0 && (<tr><td className="px-3 py-3 text-zinc-400" colSpan={4}>No hay componentes disponibles</td></tr>)}
                  {(opcDisponibles||[]).map(c => {
                    const can = canAddComponent(modalEquipo, c)
                    const selected = selectedComp?.id === c.id
                    return (
                      <tr key={c.id} className="odd:bg-zinc-900/30">
                        <td className="px-3 py-2">{c.role}</td>
                        <td className="px-3 py-2">{c.codigo}</td>
                        <td className="px-3 py-2">{c.serie}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => can.ok && setSelectedComp(c)} className={cn('px-3 py-1 rounded-xl', selected ? 'bg-blue-600 text-white' : can.ok ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700' : 'bg-zinc-800/40 text-zinc-500 cursor-not-allowed')} disabled={!can.ok} title={!can.ok?can.reason:'Seleccionar'}>
                            {selected ? 'Seleccionado' : can.ok ? 'Seleccionar' : 'No disponible'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Crear equipo */}
      <Modal
        open={openCrear}
        onClose={() => setOpenCrear(false)}
        title="Crear equipo"
        footer={(
          <>
            <button onClick={() => setOpenCrear(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
            <button onClick={handleCrearEquipo} disabled={saving} className={cn('px-3 py-2 rounded-xl text-white', saving ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-500')}>
              {saving ? 'Creando…' : 'Crear'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Código (opcional)</label>
            <input value={codigoManual} onChange={(e)=>setCodigoManual(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" placeholder="(autogenerado si vacío)" />
          </div>
          {perfil?.rol === 'centro' ? (
            <p className="text-sm text-zinc-400">Se creará en el centro: <b>{perfil?.centro_nombre || '—'}</b></p>
          ) : (
            <div>
              <label className="block text-sm mb-1 text-zinc-300">Centro (opcional)</label>
              <select value={centroSel} onChange={(e)=>setCentroSel(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
                <option value="">— Sin centro —</option>
                {(centros||[]).map(c => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal: Detalle de equipo */}
      <Modal
        open={openDetalle}
        onClose={() => setOpenDetalle(false)}
        title={`Detalle — ${detalleEquipo?.codigo || ''}`}
        footer={<button onClick={() => setOpenDetalle(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cerrar</button>}
      >
        {!detalleEquipo ? (<p>Seleccione un equipo</p>) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">Centro: <b>{detalleEquipo?.centro?.nombre || '—'}</b></p>
            <div className="border border-zinc-700 rounded-xl overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Rol</th><th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Serie</th><th className="text-left px-3 py-2">Acciones</th></tr></thead>
                <tbody>
                  {(detalleEquipo?.componentes||[]).length===0 && (<tr><td className="px-3 py-3 text-zinc-400" colSpan={4}>Sin componentes</td></tr>)}
                  {(detalleEquipo?.componentes||[]).map(c => (
                    <tr key={c.id} className="odd:bg-zinc-900/30">
                      <td className="px-3 py-2">{c.role}</td>
                      <td className="px-3 py-2">{c.codigo}</td>
                      <td className="px-3 py-2">{c.serie}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => handleDesarmar(c)} className="px-3 py-1 rounded-xl bg-rose-700 text-white hover:bg-rose-600">Desarmar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

