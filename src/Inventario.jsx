// Inventario.jsx — Vista ampliada (Oficina/Centro)
// -------------------------------------------------
// Características:
// 1) Columna de "Ubicación" en Componentes (Bodega / Centro asignado / Taller opcional)
// 2) Vista de Equipos completos con componentes actuales
// 3) Modal para "Agregar componente" al equipo con validación de compatibilidad y filtro por centro
//
// Requisitos previos:
// - Supabase configurado con tablas: componentes, equipos, equipo_componente, equipo_asignacion, centros, estados/tipos
// - RLS acorde a perfiles: Oficina (lectura global) / Centro (filtrado por sesión)
// - Ajustar nombres de columnas/relaciones según su esquema real
// - Este archivo supone React + Tailwind. Si su proyecto es vanilla JS, puedo entregar versión equivalente.
//
// ⚠️ Seguridad: Nunca exponga claves en el cliente si no son públicas (usar anon key pública de Supabase)

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// 👉 Reemplace por sus variables de entorno (Vercel) o config central
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Verificación de variables de entorno para evitar "Failed to fetch" por URL/KEY inválidas
function hasValidSupabaseEnv() {
  const badUrl = !SUPABASE_URL || SUPABASE_URL.includes('YOUR-PROJECT') || !SUPABASE_URL.startsWith('https://')
  const badKey = !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')
  return !(badUrl || badKey)
}

function humanizeError(err) {
  const msg = err?.message || String(err)
  if (msg.includes('Failed to fetch')) {
    return 'No se pudo conectar a Supabase. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (Vercel) y vuelve a desplegar.'
  }
  return msg
}

// Mapeo simple de compatibilidad por tipo de componente
// - Un equipo puede tener solo 1: ROV, Controlador, Umbilical
// - Puede tener múltiples: Sensor, Grabber (ajuste según su operación)
const UNIQUE_ROLES = ['ROV', 'Controlador', 'Umbilical']
const OPTIONAL_ROLES = ['Sensor', 'Grabber']

// Utilidades --------------------------------------------------------------
const fmt = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' })

function classNames(...arr) { return arr.filter(Boolean).join(' ') }

function guessUbicacion({ equipo }) {
  // Si el componente está asignado a un equipo y ese equipo tiene asignación vigente a un centro => nombre del centro
  // Si el equipo no tiene asignación => Bodega
  if (equipo?.centro?.nombre) return equipo.centro.nombre
  return 'Bodega'
}

function roleFromTipo(tipoNombre = '') {
  // Normaliza nombres posibles de tipo a roles esperados
  const t = (tipoNombre || '').toLowerCase()
  if (t.includes('rov')) return 'ROV'
  if (t.includes('control')) return 'Controlador'
  if (t.includes('umbil')) return 'Umbilical'
  if (t.includes('sensor')) return 'Sensor'
  if (t.includes('grab')) return 'Grabber'
  return tipoNombre || 'Desconocido'
}

// Fetchers ---------------------------------------------------------------
async function fetchPerfil() {
  // Devuelve rol y centro del usuario autenticado para filtrar vista Centro
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { rol: 'anon', centro_id: null }

  // Su esquema puede tener tabla profiles con rol y centro_id
  const { data, error } = await supabase
    .from('profiles')
    .select('rol, centro_id, centro:centros(nombre)')
    .eq('id', user.id)
    .single()
  if (error) return { rol: 'oficina', centro_id: null } // por defecto oficina si no existe
  return { rol: data?.rol || 'oficina', centro_id: data?.centro_id || null, centro_nombre: data?.centro?.nombre }
}

async function fetchComponentes({ centro_id = null, rol = 'oficina' }) {
  // Trae componentes con su equipo actual (si existe) y centro actual del equipo
  // Nota: asume que equipo_componente.fecha_fin IS NULL para vigentes
  //       y equipo_asignacion.fecha_fin IS NULL para centro actual del equipo
  let query = supabase
    .from('componentes')
    .select(`
      id, codigo, serie,
      tipo:tipo_componente_id(nombre),
      estado:estado_componente_id(nombre),
      equipo_comp:equipo_componente!left(
        fecha_inicio, fecha_fin,
        equipo:equipo_id(
          id, codigo,
          asign:equipo_asignacion!left(
            fecha_inicio, fecha_fin,
            centro:centros(id, nombre)
          )
        )
      )
    `)

  // Si es vista Centro, opcionalmente filtramos por centro
  if (rol !== 'oficina' && centro_id) {
    // Componentes en equipos asignados a mi centro OR sin equipo pero asignados por algún mecanismo a mi centro (si aplica)
    // Aquí filtramos por equipos cuyo centro vigente sea mi centro o sin equipo (Bodega del mismo centro si manejan bodegas por centro)
    // Si su bodega es global, omita este eq.
    query = query.or(`
      equipo_comp.equipo.asign.centro.id.eq.${centro_id},
      equipo_comp.is.null
    `)
  }

  const { data, error } = await query
  if (error) throw error

  // Normaliza estructura: tomar el equipo vigente (fecha_fin null) y su centro vigente
  const list = (data || []).map((row) => {
    const equipoVigente = (row.equipo_comp || []).find(e => e.fecha_fin == null)?.equipo || null
    const asignVigente = (equipoVigente?.asign || []).find(a => a.fecha_fin == null) || null
    const centro = asignVigente?.centro || null
    return {
      id: row.id,
      codigo: row.codigo,
      serie: row.serie,
      tipo: row?.tipo?.nombre || '-',
      role: roleFromTipo(row?.tipo?.nombre),
      estado: row?.estado?.nombre || '-',
      equipo: equipoVigente ? { id: equipoVigente.id, codigo: equipoVigente.codigo, centro } : null,
      ubicacion: guessUbicacion({ equipo: equipoVigente ? { centro } : null })
    }
  })

  return list
}

async function fetchEquipos({ centro_id = null, rol = 'oficina' }) {
  // Trae equipos con sus componentes vigentes y la asignación de centro vigente
  let query = supabase
    .from('equipos')
    .select(`
      id, codigo,
      asign:equipo_asignacion!left(
        fecha_inicio, fecha_fin,
        centro:centros(id, nombre)
      ),
      comps:equipo_componente!left(
        fecha_inicio, fecha_fin,
        componente:componentes(id, codigo, serie, tipo:tipo_componente_id(nombre))
      )
    `)

  if (rol !== 'oficina' && centro_id) {
    query = query.eq('asign.centro.id', centro_id)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(eq => {
    const asignVigente = (eq.asign || []).find(a => a.fecha_fin == null)
    const centro = asignVigente?.centro || null
    const componentes = (eq.comps || [])
      .filter(c => c.fecha_fin == null)
      .map(c => ({
        id: c.componente?.id,
        codigo: c.componente?.codigo,
        serie: c.componente?.serie,
        tipo: c.componente?.tipo?.nombre,
        role: roleFromTipo(c.componente?.tipo?.nombre)
      }))
    return {
      id: eq.id,
      codigo: eq.codigo,
      centro,
      componentes
    }
  })
}

async function fetchComponentesDisponiblesParaEquipo({ equipo, rol = 'oficina', centro_id = null }) {
  // Lista componentes libres (sin equipo vigente) y del mismo centro del equipo
  // 1) Determinar centro del equipo
  const equipoCentroId = equipo?.centro?.id || null

  // 2) Traer componentes sin asignación vigente (equipo_componente.fecha_fin IS NULL no existe)
  let { data, error } = await supabase
    .from('componentes')
    .select(`
      id, codigo, serie,
      tipo:tipo_componente_id(nombre),
      equipo_comp:equipo_componente!left(fecha_fin),
    `)
  if (error) throw error

  const sinEquipo = (data || []).filter(r => !r.equipo_comp?.some(ec => ec.fecha_fin == null))

  // 3) (Opcional) Filtrar por centro: si su operación tiene bodegas por centro, aquí podrían requerir otra relación.
  //    Por simplicidad, asumimos bodega global ⇒ permitimos todos sin equipo.

  return sinEquipo.map(r => ({
    id: r.id,
    codigo: r.codigo,
    serie: r.serie,
    tipo: r?.tipo?.nombre,
    role: roleFromTipo(r?.tipo?.nombre)
  }))
}

// Mutaciones --------------------------------------------------------------
async function asignarComponenteAEquipo({ componente_id, equipo_id, es_opcional = false }) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('equipo_componente')
    .insert([{ componente_id, equipo_id, fecha_inicio: now, es_opcional }])
  if (error) throw error
}

// Componentes UI ---------------------------------------------------------
function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        'px-4 py-2 text-sm font-medium rounded-2xl',
        active ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
      )}
    >
      {children}
    </button>
  )
}

function Table({ columns = [], data = [], empty = 'Sin datos' }) {
  return (
    <div className="overflow-x-auto border border-zinc-700 rounded-2xl">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-900/60">
          <tr>
            {columns.map(col => (
              <th key={col.key} className="text-left px-3 py-2 font-semibold text-zinc-200 whitespace-nowrap">{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td className="px-3 py-4 text-zinc-400" colSpan={columns.length}>{empty}</td></tr>
          )}
          {data.map((row, i) => (
            <tr key={row.id || i} className="odd:bg-zinc-900/30">
              {columns.map(col => (
                <td key={col.key} className="px-3 py-2 align-top text-zinc-100 whitespace-nowrap">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
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
      <div className="w-full max-w-2xl rounded-2xl bg-zinc-900 border border-zinc-700 shadow-xl">
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
  const [tab, setTab] = useState('componentes') // 'componentes' | 'equipos'

  const [loading, setLoading] = useState(false)
  const [componentes, setComponentes] = useState([])
  const [equipos, setEquipos] = useState([])

  // Modal de agregar componente
  const [modalOpen, setModalOpen] = useState(false)
  const [modalEquipo, setModalEquipo] = useState(null)
  const [opcDisponibles, setOpcDisponibles] = useState([])
  const [selectedComp, setSelectedComp] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [okMsg, setOkMsg] = useState('')

  // Carga inicial
  useEffect(() => {
    (async () => {
      const p = await fetchPerfil()
      setPerfil(p)
    })()
  }, [])

  useEffect(() => {
    if (!perfil) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.rol, perfil?.centro_id])

  async function refresh() {
    if (!envOk) {
      setErrorMsg('Configura las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel (Project → Settings → Environment Variables).')
      return
    }
    try {
      setLoading(true)
      const [c, e] = await Promise.all([
        fetchComponentes({ centro_id: perfil?.centro_id, rol: perfil?.rol }),
        fetchEquipos({ centro_id: perfil?.centro_id, rol: perfil?.rol })
      ])
      setComponentes(c)
      setEquipos(e)
    } catch (err) {
      console.error(err)
      setErrorMsg(humanizeError(err) || 'Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }),
        fetchEquipos({ centro_id: perfil?.centro_id, rol: perfil?.rol })
      ])
      setComponentes(c)
      setEquipos(e)
    } catch (err) {
      console.error(err)
      setErrorMsg(err.message || 'Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }

  // Abrir modal Agregar Componente
  async function openModalAgregar(equipo) {
    setErrorMsg('')
    setOkMsg('')
    setSelectedComp(null)
    setModalEquipo(equipo)
    setModalOpen(true)
    try {
      const disponibles = await fetchComponentesDisponiblesParaEquipo({ equipo, rol: perfil?.rol, centro_id: perfil?.centro_id })
      setOpcDisponibles(disponibles)
    } catch (err) {
      setErrorMsg(err.message)
    }
  }

  // Validación de compatibilidad
  function canAddComponent(equipo, componente) {
    if (!equipo || !componente) return { ok: false, reason: 'Falta selección' }
    const role = componente.role
    const yaTiene = (equipo.componentes || []).filter(c => c.role === role)
    if (UNIQUE_ROLES.includes(role) && yaTiene.length > 0) {
      return { ok: false, reason: `El equipo ya posee un ${role}` }
    }
    // Sensores/Grabber: permitimos múltiples (o limite si lo definen)
    return { ok: true }
  }

  async function handleAsignar() {
    if (!selectedComp || !modalEquipo) return
    const check = canAddComponent(modalEquipo, selectedComp)
    if (!check.ok) { setErrorMsg(check.reason); return }

    try {
      setSaving(true)
      await asignarComponenteAEquipo({
        componente_id: selectedComp.id,
        equipo_id: modalEquipo.id,
        es_opcional: OPTIONAL_ROLES.includes(selectedComp.role)
      })
      setOkMsg('Componente asignado con éxito')
      await refresh()
      setModalOpen(false)
    } catch (err) {
      setErrorMsg(err.message || 'No se pudo asignar')
    } finally {
      setSaving(false)
    }
  }

  // Columnas -------------------------------------------------------------
  const colsComponentes = [
    { key: 'codigo', header: 'ID' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'serie', header: 'Serie' },
    { key: 'estado', header: 'Estado' },
    { key: 'ubicacion', header: 'Ubicación' },
    {
      key: 'equipo', header: 'Asignado a Equipo',
      render: (val) => val ? <span className="text-blue-300">{val.codigo}</span> : <span className="text-zinc-400">—</span>
    },
  ]

  const colsEquipos = [
    { key: 'codigo', header: 'Equipo' },
    {
      key: 'centro', header: 'Centro',
      render: (val) => val?.nombre || 'Bodega'
    },
    {
      key: 'componentes', header: 'Componentes',
      render: (val) => (
        <div className="flex flex-wrap gap-2">
          {(val || []).map(v => (
            <span key={v.id} className="px-2 py-1 rounded-xl bg-zinc-800 text-zinc-200 text-xs border border-zinc-700">
              {v.role}: <b>{v.codigo}</b>
            </span>
          ))}
          {(!val || val.length === 0) && <span className="text-zinc-400">—</span>}
        </div>
      )
    },
    {
      key: 'acciones', header: 'Acciones',
      render: (_val, row) => (
        <div className="flex gap-2">
          <button onClick={() => openModalAgregar(row)} className="px-3 py-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">Agregar Componente</button>
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
          {!envOk && (
            <p className="mt-2 text-xs text-amber-300">Modo instalación: faltan variables de entorno. Configúralas para conectar.</p>
          )}
        </div>
        <div className="flex gap-2">
          <TabButton active={tab==='componentes'} onClick={() => setTab('componentes')}>Componentes</TabButton>
          <Tab

      {errorMsg && (
        <div className="p-3 rounded-xl border border-red-700 bg-red-900/20 text-red-200">{errorMsg}</div>
      )}
      {okMsg && (
        <div className="p-3 rounded-xl border border-emerald-700 bg-emerald-900/20 text-emerald-200">{okMsg}</div>
      )}

      {tab === 'componentes' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-100">Componentes</h2>
          <Table columns={colsComponentes} data={componentes} empty={loading ? 'Cargando…' : 'Sin componentes'} />
        </section>
      )}

      {tab === 'equipos' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-100">Equipos</h2>
          <Table columns={colsEquipos} data={equipos} empty={loading ? 'Cargando…' : 'Sin equipos'} />
        </section>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Agregar componente a ${modalEquipo?.codigo || ''}`}
        footer={(
          <>
            <button onClick={() => setModalOpen(false)} className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700">Cancelar</button>
            <button onClick={handleAsignar} disabled={!selectedComp || saving} className={classNames('px-3 py-2 rounded-xl text-white', (!selectedComp||saving)?'bg-zinc-700':'bg-blue-600 hover:bg-blue-500')}>
              {saving ? 'Asignando…' : 'Asignar'}
            </button>
          </>
        )}
      >
        {!modalEquipo ? (
          <p>Seleccione un equipo</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-zinc-400">Centro del equipo: <b>{modalEquipo?.centro?.nombre || 'Bodega'}</b></p>
              <p className="text-sm text-zinc-400">Componentes actuales: {(modalEquipo?.componentes||[]).map(c=>c.role).join(', ') || '—'}</p>
            </div>
            <div className="max-h-80 overflow-auto border border-zinc-700 rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60">
                  <tr>
                    <th className="text-left px-3 py-2">Rol</th>
                    <th className="text-left px-3 py-2">ID</th>
                    <th className="text-left px-3 py-2">Serie</th>
                    <th className="text-left px-3 py-2">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {(opcDisponibles||[]).length===0 && (
                    <tr><td className="px-3 py-3 text-zinc-400" colSpan={4}>No hay componentes disponibles</td></tr>
                  )}
                  {(opcDisponibles||[]).map(c => {
                    const can = canAddComponent(modalEquipo, c)
                    const selected = selectedComp?.id === c.id
                    return (
                      <tr key={c.id} className="odd:bg-zinc-900/30">
                        <td className="px-3 py-2">{c.role}</td>
                        <td className="px-3 py-2">{c.codigo}</td>
                        <td className="px-3 py-2">{c.serie}</td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => can.ok && setSelectedComp(c)}
                            className={classNames(
                              'px-3 py-1 rounded-xl',
                              selected ? 'bg-blue-600 text-white' : can.ok ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700' : 'bg-zinc-800/40 text-zinc-500 cursor-not-allowed'
                            )}
                            disabled={!can.ok}
                            title={!can.ok ? can.reason : 'Seleccionar'}
                          >
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
    </div>
  )
}

