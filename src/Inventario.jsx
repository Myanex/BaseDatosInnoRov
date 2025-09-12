'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

// ========================= Utils =========================
const cn = (...a) => a.filter(Boolean).join(' ')
const suffix = (code = '') => (code.split('-')[1] || '').trim()
const UNIQUE_ROLES = ['ROV', 'CONTROLADOR', 'UMBILICAL', 'GRABBER']

function roleFromTipo(tipoNombre = '') {
  const t = (tipoNombre || '').toLowerCase()
  if (t.includes('rov')) return 'ROV'
  if (t.includes('control')) return 'CONTROLADOR'
  if (t.includes('umbil')) return 'UMBILICAL'
  if (t.includes('sensor')) return 'SENSOR'
  if (t.includes('grab')) return 'GRABBER'
  return (tipoNombre || 'DESCONOCIDO').toUpperCase()
}

// ========================= UI Elements =========================
function Chip({ active, children, onClick }) {
  return (
    <button onClick={onClick} className={cn('px-2.5 py-1 rounded-xl text-xs border', active ? 'bg-blue-600 text-white border-blue-500' : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700')}>{children}</button>
  )
}

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

// ========================= Data Fetchers =========================
async function fetchPerfil() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { rol: 'oficina', centro_id: null }

  const { data, error } = await supabase.from('profiles').select('rol, user_id').eq('user_id', user.id).single()
  if (error) return { rol: 'oficina', centro_id: null }

  let centro_id = null, centro_nombre = null
  try {
    const { data: ubic } = await supabase.from('v_usuario_ubicacion_actual').select('centro_id, centro').eq('user_id', user.id).maybeSingle()
    centro_id = ubic?.centro_id || null
    centro_nombre = ubic?.centro || null
  } catch {}

  return { rol: data?.rol || 'oficina', centro_id, centro_nombre }
}

async function fetchCentros() {
  const { data, error } = await supabase.from('centros').select('id, nombre').order('nombre', { ascending: true })
  if (error) throw error
  return data || []
}

async function fetchTiposEstados() {
  const [{ data: tipos }, { data: estados }] = await Promise.all([
    supabase.from('tipo_componente').select('id, nombre, display_name, codigo').order('display_name', { ascending: true }),
    supabase.from('estado_componente').select('id, nombre').order('nombre', { ascending: true })
  ])
  return { tipos: tipos || [], estados: estados || [] }
}

async function fetchComponentesVista() {
  const { data, error } = await supabase
    .from('v_componente_ubicacion_actual')
    .select('componente_id, codigo, serie, tipo, estado, fecha_ingreso, ubic_tipo, centro, equipo_codigo')
    .order('codigo', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({
    id: r.componente_id,
    codigo: r.codigo,
    serie: r.serie,
    tipo: r.tipo,
    role: roleFromTipo(r.tipo),
    estado: r.estado,
    fecha_ingreso: r.fecha_ingreso,
    ubic_tipo: r.ubic_tipo,   // 'equipo' | 'bodega' | 'transito' | 'reserva'
    centro: r.centro || '—',
    equipo_codigo: r.equipo_codigo || null,
    ubicacion:
      r.ubic_tipo === 'equipo'   ? `${r.centro || '—'} · ${r.equipo_codigo || ''}` :
      r.ubic_tipo === 'bodega'   ? `Bodega · ${(r.centro && r.centro !== '—') ? r.centro : 'Oficina'}` :
      r.ubic_tipo === 'transito' ? `Tránsito → ${r.centro || '—'}` :
                                   'Reserva'
  }))
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

  // Estado de taller
  let tallerMap = {}
  try {
    const { data: t } = await supabase.from('v_equipo_taller_actual').select('equipo_id, taller, en_taller')
    for (const x of (t || [])) tallerMap[x.equipo_id] = { en_taller: x.en_taller, taller: x.taller }
  } catch {}

  const mapped = (data || []).map(eq => {
    const asignVig = (eq.asign || []).find(a => a.fecha_fin == null)
    const centro = asignVig?.centro || null
    const componentes = (eq.comps || [])
      .filter(c => c.fecha_fin == null)
      .map(c => ({ id: c.componente?.id, codigo: c.componente?.codigo, serie: c.componente?.serie, role: roleFromTipo(c.componente?.tipo?.nombre) }))
    const taller = tallerMap[eq.id] || { en_taller: false, taller: null }
    return { id: eq.id, codigo: eq.codigo, centro, componentes, en_taller: !!taller.en_taller, taller_nombre: taller.taller }
  })

  const filtered = (rol !== 'oficina' && centro_id)
    ? mapped.filter(e => e.centro?.id === centro_id)
    : mapped
  return filtered
}

async function fetchComponentesDisponiblesParaEquipo() {
  const { data, error } = await supabase
    .from('componentes')
    .select(`id, codigo, serie, tipo:tipo_componente_id(nombre), ec:equipo_componente!left(fecha_fin)`) // componentes sin equipo
  if (error) throw error
  const sinEquipo = (data || []).filter(r => !r.ec?.some(x => x.fecha_fin == null))
  return sinEquipo.map(r => ({ id: r.id, codigo: r.codigo, serie: r.serie, role: roleFromTipo(r?.tipo?.nombre) }))
}

// ========================= RPC wrappers =========================
async function rpcEnsamblar({ equipo_id, componente_id, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_ensamblar_componente', { p_equipo_id: equipo_id, p_componente_id: componente_id, p_fecha: fecha })
  if (error) throw error
  return data
}

async function rpcDesarmar({ equipo_id, componente_id, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_desarmar_componente', { p_equipo_id: equipo_id, p_componente_id: componente_id, p_fecha: fecha })
  if (error) throw error
  return data
}

async function rpcCrearEquipo({ codigo = '', centroId = null, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_equipo_crear', { p_codigo: codigo || null, p_centro_id: centroId || null, p_fecha: fecha || null })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

// *** CREA COMPONENTE — usa RPC (no insert directo) ***
async function createComponente({ tipoId, estadoId, serie, fecha, codigoManual, centroBodegaId }) {
  const { data, error } = await supabase.rpc('rpc_componente_crear', {
    p_tipo_id: tipoId,
    p_estado_id: estadoId,
    p_serie: serie,
    p_fecha: fecha || null,
    p_codigo: codigoManual || null,
    p_bodega_centro: centroBodegaId || null,
  })
  if (error) throw new Error(error.details || error.message || JSON.stringify(error))
  const row = Array.isArray(data) ? data[0] : data
  return row // { id, codigo }
}

async function rpcMovCrear({ origenId = null, destinoId, componenteIds = [], fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_mov_crear', { p_origen: origenId, p_destino: destinoId, p_fecha: fecha || null, p_componentes: componenteIds })
  if (error) throw error
  return data // uuid movimiento
}

async function rpcMovRecepcionar({ movimientoId, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_mov_recepcionar', { p_movimiento_id: movimientoId, p_fecha: fecha || null })
  if (error) throw error
  return data
}

async function rpcEquipoTallerCheckin({ equipo_id, taller = 'Taller', fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_equipo_taller_checkin', { p_equipo_id: equipo_id, p_taller: taller, p_fecha: fecha || null })
  if (error) throw error
  return data
}

async function rpcEquipoTallerCheckout({ equipo_id, fecha = null }) {
  const { data, error } = await supabase.rpc('rpc_equipo_taller_checkout', { p_equipo_id: equipo_id, p_fecha: fecha || null })
  if (error) throw error
  return data
}

// ========================= Page =========================
export default function Inventario() {
  const [perfil, setPerfil] = useState({ rol: 'oficina', centro_id: null })
  const [tab, setTab] = useState('componentes')

  const [loading, setLoading] = useState(false)
  const [componentes, setComponentes] = useState([])
  const [equipos, setEquipos] = useState([])
  const [centros, setCentros] = useState([])

  // Filtros / búsqueda
  const [qComp, setQComp] = useState('')
  const [qEq, setQEq] = useState('')
  const [tipos, setTipos] = useState([])
  const [estados, setEstados] = useState([])
  const [tipoChips, setTipoChips] = useState([])

  // Modales & states
  const [modalOpen, setModalOpen] = useState(false) // Ensamblar
  const [modalEquipo, setModalEquipo] = useState(null)
  const [opcDisponibles, setOpcDisponibles] = useState([])
  const [selectedComp, setSelectedComp] = useState(null)

  const [openCrear, setOpenCrear] = useState(false) // Crear equipo
  const [codigoManualEquipo, setCodigoManualEquipo] = useState('')
  const [centroSelEquipo, setCentroSelEquipo] = useState('')

  const [openAddComp, setOpenAddComp] = useState(false) // Crear componente
  const [tipoSel, setTipoSel] = useState('')
  const [estadoSel, setEstadoSel] = useState('')
  const [serieNueva, setSerieNueva] = useState('')
  const [fechaIng, setFechaIng] = useState(() => new Date().toISOString().slice(0, 10))
  const [codigoManualComp, setCodigoManualComp] = useState('')
  const [centroBodegaSel, setCentroBodegaSel] = useState('')

  const [openMover, setOpenMover] = useState(false) // Mover a bodega
  const [compAMover, setCompAMover] = useState(null)
  const [destCentroId, setDestCentroId] = useState('')

  const [openTaller, setOpenTaller] = useState(false) // Equipo a taller
  const [equipoTaller, setEquipoTaller] = useState(null)
  const [tallerNombre, setTallerNombre] = useState('Taller')

  const [openDetalle, setOpenDetalle] = useState(false)
  const [detalleEquipo, setDetalleEquipo] = useState(null)
  function openModalDetalle(equipo) { setDetalleEquipo(equipo); setOpenDetalle(true) }

  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => { (async () => { const p = await fetchPerfil(); setPerfil(p) })() }, [])
  useEffect(() => { if (perfil) refresh() }, [perfil?.rol, perfil?.centro_id])
  useEffect(() => { (async () => { try { const cs = await fetchCentros(); setCentros(cs) } catch {} })() }, [])
  useEffect(() => { (async () => { try { const { tipos, estados } = await fetchTiposEstados(); setTipos(tipos); setEstados(estados); } catch {} })() }, [])

  async function refresh() {
    try {
      setLoading(true)
      const [c, e] = await Promise.all([
        fetchComponentesVista(),
        fetchEquipos({ centro_id: perfil?.centro_id, rol: perfil?.rol })
      ])
      setComponentes(c)
      setEquipos(e)
    } catch (err) {
      setErrorMsg(err.message || 'Error al cargar datos')
    } finally { setLoading(false) }
  }

  // Ensamblar ------------------------------------------------------------
  async function openModalEnsamblar(equipo) {
    setErrorMsg(''); setOkMsg(''); setSelectedComp(null)
    setModalEquipo(equipo); setModalOpen(true)
    try { const disp = await fetchComponentesDisponiblesParaEquipo(); setOpcDisponibles(disp) } catch (e) { setErrorMsg(e.message) }
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
    } catch (err) { setErrorMsg(err.message || 'No se pudo ensamblar') }
    finally { setSaving(false) }
  }

  async function handleDesarmar(comp) {
    if (!detalleEquipo || !comp) return
    try {
      setSaving(true)
      await rpcDesarmar({ equipo_id: detalleEquipo.id, componente_id: comp.id })
      setOkMsg('Componente desarmado')
      await refresh()
    } catch (err) { setErrorMsg(err.message || 'No se pudo desarmar') }
    finally { setSaving(false) }
  }

  // Crear equipo ---------------------------------------------------------
  async function handleCrearEquipo() {
    try {
      setSaving(true)
      const centroId = perfil?.rol === 'centro' ? perfil?.centro_id : (centroSelEquipo || null)
      const res = await rpcCrearEquipo({ codigo: codigoManualEquipo.trim(), centroId })
      setOkMsg(`Equipo creado: ${res?.codigo || ''}`)
      setOpenCrear(false); setCodigoManualEquipo(''); setCentroSelEquipo('')
      await refresh()
    } catch (err) { setErrorMsg(err.message || 'No se pudo crear el equipo') }
    finally { setSaving(false) }
  }

  // Crear componente -----------------------------------------------------
  function openModalAddComp() { setErrorMsg(''); setOkMsg(''); setOpenAddComp(true) }

  async function handleCrearComponente() {
    try {
      if (!tipoSel || !estadoSel || !serieNueva.trim()) { setErrorMsg('Tipo, Estado y Serie son obligatorios'); return }
      setSaving(true)
      const comp = await createComponente({
        tipoId: tipoSel,
        estadoId: estadoSel,
        serie: serieNueva.trim(),
        fecha: fechaIng,
        codigoManual: codigoManualComp.trim() || null,
        centroBodegaId: centroBodegaSel || null,
      })
      setOkMsg(`Componente creado: ${comp?.codigo || ''}`)
      setOpenAddComp(false)
      // reset
      setTipoSel(''); setEstadoSel(''); setSerieNueva(''); setFechaIng(new Date().toISOString().slice(0, 10)); setCodigoManualComp(''); setCentroBodegaSel('')
      await refresh()
    } catch (err) { setErrorMsg(err.message || 'No se pudo crear el componente') }
    finally { setSaving(false) }
  }

  // Mover a bodega de… ---------------------------------------------------
  function openModalMover(comp) { setCompAMover(comp); setDestCentroId(''); setOpenMover(true); setErrorMsg(''); setOkMsg('') }

  async function handleMover() {
    if (!compAMover || !destCentroId) { setErrorMsg('Selecciona destino'); return }
    if (!(compAMover.ubic_tipo === 'bodega' || compAMover.ubic_tipo === 'reserva')) {
      setErrorMsg('Sólo puedes mover componentes en bodega o reserva.'); return
    }
    try {
      setSaving(true)
      // origen actual (si está en bodega)
      let origenId = null
      if (compAMover.ubic_tipo === 'bodega') {
        const { data: origenRow } = await supabase.from('componente_bodega_historial').select('centro_id').eq('componente_id', compAMover.id).is('fecha_fin', null).maybeSingle()
        origenId = origenRow?.centro_id || null
      }
      const movId = await rpcMovCrear({ origenId, destinoId: destCentroId, componenteIds: [compAMover.id], fecha: new Date().toISOString().slice(0, 10) })
      await rpcMovRecepcionar({ movimientoId: movId })
      setOkMsg('Movimiento realizado')
      setOpenMover(false)
      await refresh()
    } catch (err) { setErrorMsg(err.message || 'No se pudo mover') }
    finally { setSaving(false) }
  }

  // Taller (equipos) -----------------------------------------------------
  function openModalTaller(eq) { setEquipoTaller(eq); setTallerNombre(eq?.taller_nombre || 'Taller'); setOpenTaller(true); setErrorMsg(''); setOkMsg('') }

  async function handleTaller() {
    if (!equipoTaller) return
    try {
      setSaving(true)
      if (!equipoTaller.en_taller) {
        await rpcEquipoTallerCheckin({ equipo_id: equipoTaller.id, taller: tallerNombre || 'Taller' })
        setOkMsg('Equipo enviado a taller')
      } else {
        await rpcEquipoTallerCheckout({ equipo_id: equipoTaller.id })
        setOkMsg('Equipo retornó de taller')
      }
      setOpenTaller(false)
      await refresh()
    } catch (err) { setErrorMsg(err.message || 'No se pudo actualizar taller (¿falta patch SQL?)') }
    finally { setSaving(false) }
  }

  // Filtros --------------------------------------------------------------
  const compFiltrados = useMemo(() => {
    const q = qComp.trim().toLowerCase()
    let base = componentes
    if (tipoChips.length > 0) {
      const selectedRoles = tipos.filter(t => tipoChips.includes(t.id)).map(t => roleFromTipo(t.nombre))
      base = base.filter(x => selectedRoles.includes(x.role))
    }
    if (!q) return base
    return base.filter(x => (x.codigo || '').toLowerCase().includes(q) || (x.tipo || '').toLowerCase().includes(q) || (x.serie || '').toLowerCase().includes(q) || (x.ubicacion || '').toLowerCase().includes(q))
  }, [componentes, qComp, tipoChips, tipos])

  const equiposFiltrados = useMemo(() => {
    const q = qEq.trim().toLowerCase()
    if (!q) return equipos
    return equipos.filter(x => (x.codigo || '').toLowerCase().includes(q) || (x.centro?.nombre || '').toLowerCase().includes(q) || (x.componentes || []).some(c => (c.codigo || '').toLowerCase().includes(q) || (c.role || '').toLowerCase().includes(q)))
  }, [equipos, qEq])

  // Columnas -------------------------------------------------------------
  const colsComponentes = [
    { key: 'codigo', header: 'ID' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'serie', header: 'Serie' },
    { key: 'estado', header: 'Estado' },
    { key: 'ubicacion', header: 'Ubicación' },
    { key: 'acciones', header: 'Acciones', render: (_val, row) => (
      <div className="flex gap-2">
        <button onClick={() => openModalMover(row)} disabled={!(row.ubic_tipo === 'bodega' || row.ubic_tipo === 'reserva')} className={cn('px-3 py-1 rounded-xl', (row.ubic_tipo === 'bodega' || row.ubic_tipo === 'reserva') ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700' : 'bg-zinc-800/40 text-zinc-500 cursor-not-allowed')}>Mover a bodega…</button>
      </div>
    ) }
  ]

  const colsEquipos = [
    { key: 'codigo', header: 'Equipo' },
    { key: 'centro', header: 'Centro', render: (val) => val?.nombre || '—' },
    { key: 'estado', header: 'Estado', render: (_val, row) => {
      const roles = row.componentes?.map(c => c.role) || []
      const coreOK = ['ROV', 'CONTROLADOR', 'UMBILICAL'].every(r => roles.includes(r))
      const rov = row.componentes.find(c => c.role === 'ROV')
      const ctrl = row.componentes.find(c => c.role === 'CONTROLADOR')
      const pareados = rov && ctrl && suffix(rov.codigo) && suffix(rov.codigo) === suffix(ctrl.codigo)
      return (
        <div className="flex gap-2 items-center">
          <span className={cn('px-2 py-0.5 rounded text-xs', coreOK ? 'bg-emerald-700/30 text-emerald-200' : 'bg-zinc-700/40 text-zinc-200')}>{coreOK ? 'Core OK' : 'Core incompleto'}</span>
          <span className={cn('px-2 py-0.5 rounded text-xs', pareados ? 'bg-sky-700/30 text-sky-200' : 'bg-zinc-700/40 text-zinc-200')}>{pareados ? 'ROV/CTRL pareados' : 'No pareados'}</span>
          {row.en_taller && <span className="px-2 py-0.5 rounded text-xs bg-amber-700/30 text-amber-200">En taller</span>}
        </div>
      )
    } },
    { key: 'acciones', header: 'Acciones', render: (_val, row) => (
      <div className="flex gap-2">
        <button onClick={() => openModalDetalle(row)} className="px-3 py-1 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Detalle</button>
        <button onClick={() => openModalEnsamblar(row)} className="px-3 py-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">Ensamblar</button>
        <button onClick={() => openModalTaller(row)} className={cn('px-3 py-1 rounded-xl', row.en_taller ? 'bg-amber-700 text-white hover:bg-amber-600' : 'bg-amber-600 text-white hover:bg-amber-500')}>{row.en_taller ? 'Retornar taller' : 'Enviar a taller'}</button>
      </div>
    ) }
  ]

  // ========================= Render =========================
  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Inventario</h1>
          <p className="text-sm text-zinc-400">Perfil: <b>{perfil?.rol || '—'}</b> {perfil?.centro_nombre ? `· Centro ${perfil.centro_nombre}` : ''}</p>
        </div>
        <div className="flex gap-2">
          <TabButton active={tab === 'componentes'} onClick={() => setTab('componentes')}>Componentes</TabButton>
          <TabButton active={tab === 'equipos'} onClick={() => setTab('equipos')}>Equipos</TabButton>
          <button onClick={refresh} className="px-3 py-2 rounded-2xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Recargar</button>
        </div>
      </header>

      {errorMsg && (<div className="p-3 rounded-xl border border-red-700 bg-red-900/20 text-red-200">{errorMsg}</div>)}
      {okMsg && (<div className="p-3 rounded-xl border border-emerald-700 bg-emerald-900/20 text-emerald-200">{okMsg}</div>)}

      {tab === 'componentes' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-zinc-100">Componentes</h2>
            <div className="flex gap-2 items-center">
              <Chip active={tipoChips.length === 0} onClick={() => setTipoChips([])}>Todos</Chip>
              {(tipos || []).map(t => (
                <Chip key={t.id} active={tipoChips.includes(t.id)} onClick={() => setTipoChips(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])}>{t.display_name || t.nombre}</Chip>
              ))}
              <input value={qComp} onChange={e => setQComp(e.target.value)} placeholder="Buscar…" className="w-56 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              <button onClick={openModalAddComp} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Agregar componente</button>
            </div>
          </div>
          <Table columns={colsComponentes} data={compFiltrados} empty={loading ? 'Cargando…' : 'Sin componentes'} />
        </section>
      )}

      {tab === 'equipos' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">Equipos</h2>
            <div className="flex gap-2 items-center">
              <input value={qEq} onChange={e => setQEq(e.target.value)} placeholder="Buscar…" className="w-56 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              <button onClick={() => setOpenCrear(true)} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500">Crear equipo</button>
            </div>
          </div>
          <Table columns={colsEquipos} data={equiposFiltrados} empty={loading ? 'Cargando…' : 'Sin equipos'} />
        </section>
      )}

      {/* Modal: Ensamblar */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`Ensamblar en ${modalEquipo?.codigo || ''}`}
        footer={<>
          <button onClick={() => setModalOpen(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
          <button onClick={handleEnsamblar} disabled={!selectedComp || saving} className={cn('px-3 py-2 rounded-xl text-white', (!selectedComp || saving) ? 'bg-zinc-700' : 'bg-emerald-600 hover:bg-emerald-500')}>{saving ? 'Ensamblando…' : 'Ensamblar'}</button>
        </>}
      >
        {!modalEquipo ? (<p>Seleccione un equipo</p>) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-zinc-400">Centro del equipo: <b>{modalEquipo?.centro?.nombre || '—'}</b></p>
              <p className="text-sm text-zinc-400">Actual: {(modalEquipo?.componentes || []).map(c => `${c.role}:${c.codigo}`).join(', ') || '—'}</p>
              <p className="text-xs text-zinc-500">La BD valida centro/ubicación y unicidad de ROV/CTRL/UMB/GRB.</p>
            </div>
            <div className="max-h-80 overflow-auto border border-zinc-700 rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Rol</th><th className="text-left px-3 py-2">ID</th><th className="text-left px-3 py-2">Serie</th><th className="text-left px-3 py-2">Acción</th></tr></thead>
                <tbody>
                  {(opcDisponibles || []).length === 0 && (<tr><td className="px-3 py-3 text-zinc-400" colSpan={4}>No hay componentes disponibles</td></tr>)}
                  {(opcDisponibles || []).map(c => {
                    const selected = selectedComp?.id === c.id
                    return (
                      <tr key={c.id} className="odd:bg-zinc-900/30">
                        <td className="px-3 py-2">{c.role}</td>
                        <td className="px-3 py-2">{c.codigo}</td>
                        <td className="px-3 py-2">{c.serie}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => setSelectedComp(c)} className={cn('px-3 py-1 rounded-xl', selected ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700')}>{selected ? 'Seleccionado' : 'Seleccionar'}</button>
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
      <Modal open={openCrear} onClose={() => setOpenCrear(false)} title="Crear equipo"
        footer={<>
          <button onClick={() => setOpenCrear(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
          <button onClick={handleCrearEquipo} disabled={saving} className={cn('px-3 py-2 rounded-xl text-white', saving ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-500')}>{saving ? 'Creando…' : 'Crear'}</button>
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Código (opcional)</label>
            <input value={codigoManualEquipo} onChange={(e) => setCodigoManualEquipo(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" placeholder="(autogenerado si vacío)" />
          </div>
          {perfil?.rol === 'centro' ? (
            <p className="text-sm text-zinc-400">Se creará en el centro: <b>{perfil?.centro_nombre || '—'}</b></p>
          ) : (
            <div>
              <label className="block text-sm mb-1 text-zinc-300">Centro (opcional)</label>
              <select value={centroSelEquipo} onChange={(e) => setCentroSelEquipo(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
                <option value="">— Sin centro —</option>
                {(centros || []).map(c => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal: Agregar componente */}
      <Modal open={openAddComp} onClose={() => setOpenAddComp(false)} title="Agregar componente"
        footer={<>
          <button onClick={() => setOpenAddComp(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
          <button onClick={handleCrearComponente} disabled={saving} className={cn('px-3 py-2 rounded-xl text-white', saving ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-500')}>{saving ? 'Creando…' : 'Crear'}</button>
        </>}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Tipo</label>
            <select value={tipoSel} onChange={e => setTipoSel(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
              <option value="">— Seleccionar —</option>
              {(tipos || []).map(t => (<option key={t.id} value={t.id}>{t.display_name || t.nombre}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Estado</label>
            <select value={estadoSel} onChange={e => setEstadoSel(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
              <option value="">— Seleccionar —</option>
              {(estados || []).map(es => (<option key={es.id} value={es.id}>{es.nombre}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Serie (fábrica)</label>
            <input value={serieNueva} onChange={e => setSerieNueva(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" placeholder="SN-..." />
          </div>
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Fecha de ingreso</label>
            <input type="date" value={fechaIng} onChange={e => setFechaIng(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Código interno (opcional)</label>
            <input value={codigoManualComp} onChange={e => setCodigoManualComp(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" placeholder="(autogenerado si vacío)" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Bodega inicial (opcional)</label>
            <select value={centroBodegaSel} onChange={e => setCentroBodegaSel(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
              <option value="">— Sin bodega (reserva) —</option>
              {(centros || []).map(c => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">Si seleccionas un centro, se registrará en su bodega.</p>
          </div>
        </div>
      </Modal>

      {/* Modal: Detalle de equipo */}
      <Modal open={openDetalle} onClose={() => setOpenDetalle(false)} title={`Detalle — ${detalleEquipo?.codigo || ''}`}
        footer={<button onClick={() => setOpenDetalle(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cerrar</button>}
      >
        {!detalleEquipo ? (<p>Seleccione un equipo</p>) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">Centro: <b>{detalleEquipo?.centro?.nombre || '—'}</b></p>
            <div className="border border-zinc-700 rounded-xl overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Rol</th><th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Serie</th><th className="text-left px-3 py-2">Acciones</th></tr></thead>
                <tbody>
                  {(detalleEquipo?.componentes || []).length === 0 && (<tr><td className="px-3 py-3 text-zinc-400" colSpan={4}>Sin componentes</td></tr>)}
                  {(detalleEquipo?.componentes || []).map(c => (
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

      {/* Modal: Mover a bodega de… */}
      <Modal open={openMover} onClose={() => setOpenMover(false)} title={`Mover ${compAMover?.codigo || ''} a bodega de…`}
        footer={<>
          <button onClick={() => setOpenMover(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
          <button onClick={handleMover} disabled={saving || !destCentroId} className={cn('px-3 py-2 rounded-xl text-white', (!destCentroId || saving) ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-500')}>{saving ? 'Moviendo…' : 'Mover'}</button>
        </>}
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Estado actual: <b>{compAMover?.ubicacion || '—'}</b></p>
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Destino</label>
            <select value={destCentroId} onChange={e => setDestCentroId(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
              <option value="">— Selecciona centro —</option>
              {(centros || []).map(c => (<option key={c.id} value={c.id}>{c.nombre}</option>))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">Se crea un envío (tránsito) y se recepciona automáticamente en el destino.</p>
          </div>
        </div>
      </Modal>

      {/* Modal: Taller (equipos) */}
      <Modal open={openTaller} onClose={() => setOpenTaller(false)} title={equipoTaller?.en_taller ? 'Retornar de taller' : 'Enviar a taller'}
        footer={<>
          <button onClick={() => setOpenTaller(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
          <button onClick={handleTaller} disabled={saving} className={cn('px-3 py-2 rounded-xl text-white', saving ? 'bg-zinc-700' : 'bg-amber-600 hover:bg-amber-500')}>{saving ? 'Guardando…' : (equipoTaller?.en_taller ? 'Retornar' : 'Enviar')}</button>
        </>}
      >
        {!equipoTaller?.en_taller ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">Equipo: <b>{equipoTaller?.codigo}</b></p>
            <div>
              <label className="block text-sm mb-1 text-zinc-300">Nombre del taller</label>
              <input value={tallerNombre} onChange={e => setTallerNombre(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" placeholder="Taller" />
            </div>
            <p className="text-xs text-zinc-500">Se registrará la entrada al taller desde la fecha actual.</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">¿Confirmas el retorno de <b>{equipoTaller?.codigo}</b> desde el taller <b>{equipoTaller?.taller_nombre || 'Taller'}</b>?</p>
        )}
      </Modal>
    </div>
  )
}


