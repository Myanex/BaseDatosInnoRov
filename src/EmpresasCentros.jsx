
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

const cn = (...a) => a.filter(Boolean).join(' ')

function Card({ title, children, footer }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-zinc-100 font-semibold">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
      {footer && <div className="pt-3 border-t border-zinc-700 mt-3">{footer}</div>}
    </div>
  )
}

export default function EmpresaCentros() {
  const [perfil, setPerfil] = useState({ rol: 'oficina' })

  const [empresas, setEmpresas] = useState([])
  const [zonas, setZonas] = useState([])
  const [centros, setCentros] = useState([])

  const [empresaSel, setEmpresaSel] = useState('')
  const [zonaSel, setZonaSel] = useState('')

  // forms
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [zonaNombre, setZonaNombre] = useState('')
  const [centroNombre, setCentroNombre] = useState('')
  const [centroFecha, setCentroFecha] = useState(() => new Date().toISOString().slice(0,10))

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [okMsg, setOkMsg] = useState('')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('profiles').select('rol').eq('user_id', user.id).maybeSingle()
      setPerfil({ rol: data?.rol || 'oficina' })
    }
  })() }, [])

  async function loadEmpresas() {
    const { data, error } = await supabase.from('empresas').select('id, nombre, is_active').order('nombre', { ascending: true })
    if (error) throw error
    setEmpresas(data || [])
  }
  async function loadZonas(empId) {
    const { data, error } = await supabase.from('zonas').select('id, nombre, empresa_id').eq('empresa_id', empId).order('nombre', { ascending: true })
    if (error) throw error
    setZonas(data || [])
  }
  async function loadCentros(zonId) {
    const { data, error } = await supabase.from('centros').select('id, nombre, zona_id, fecha_inicio').eq('zona_id', zonId).order('nombre', { ascending: true })
    if (error) throw error
    setCentros(data || [])
  }

  async function refreshAll() {
    try {
      setLoading(true)
      await loadEmpresas()
      if (empresaSel) await loadZonas(empresaSel)
      else { setZonas([]); setZonaSel(''); setCentros([]) }
      if (zonaSel) await loadCentros(zonaSel)
    } catch (e) {
      setErrMsg(e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { refreshAll() }, [])
  useEffect(() => { if (empresaSel) { loadZonas(empresaSel); setZonaSel(''); setCentros([]) } }, [empresaSel])
  useEffect(() => { if (zonaSel) { loadCentros(zonaSel) } else { setCentros([]) } }, [zonaSel])

  // Actions -------------------------------------------------------------
  async function crearEmpresa() {
    if (!empresaNombre.trim()) { setErrMsg('Nombre de empresa es obligatorio'); return }
    try {
      setSaving(true)
      const { error } = await supabase.from('empresas').insert({ nombre: empresaNombre.trim(), is_active: true })
      if (error) throw error
      setEmpresaNombre('')
      setOkMsg('Empresa creada')
      await loadEmpresas()
    } catch (e) { setErrMsg(e.message) } finally { setSaving(false) }
  }

  async function toggleEmpresaActiva(emp) {
    try {
      setSaving(true)
      const { error } = await supabase.from('empresas').update({ is_active: !emp.is_active }).eq('id', emp.id)
      if (error) throw error
      await loadEmpresas()
    } catch (e) { setErrMsg(e.message) } finally { setSaving(false) }
  }

  async function crearZona() {
    if (!empresaSel) { setErrMsg('Selecciona una empresa'); return }
    if (!zonaNombre.trim()) { setErrMsg('Nombre de zona es obligatorio'); return }
    try {
      setSaving(true)
      const { error } = await supabase.from('zonas').insert({ nombre: zonaNombre.trim(), empresa_id: empresaSel })
      if (error) throw error
      setZonaNombre('')
      setOkMsg('Zona creada')
      await loadZonas(empresaSel)
    } catch (e) { setErrMsg(e.message) } finally { setSaving(false) }
  }

  async function crearCentro() {
    if (!zonaSel) { setErrMsg('Selecciona una zona'); return }
    if (!centroNombre.trim()) { setErrMsg('Nombre de centro es obligatorio'); return }
    try {
      setSaving(true)
      const { error } = await supabase.from('centros').insert({ nombre: centroNombre.trim(), zona_id: zonaSel, fecha_inicio: centroFecha || null })
      if (error) throw error
      setCentroNombre('')
      setOkMsg('Centro creado')
      await loadCentros(zonaSel)
    } catch (e) { setErrMsg(e.message) } finally { setSaving(false) }
  }

  // Render --------------------------------------------------------------
  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Empresas / Zonas / Centros</h1>
          <p className="text-sm text-zinc-400">Perfil: <b>{perfil?.rol}</b></p>
        </div>
        <div className="flex gap-2">
          <button onClick={refreshAll} className="btn-ghost">Recargar</button>
        </div>
      </header>

      {errMsg && <div className="p-3 rounded-xl border border-red-700 bg-red-900/20 text-red-200">{errMsg}</div>}
      {okMsg && <div className="p-3 rounded-xl border border-emerald-700 bg-emerald-900/20 text-emerald-200">{okMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Empresas */}
        <Card title="Empresas">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={empresaNombre} onChange={e=>setEmpresaNombre(e.target.value)} placeholder="Nombre de empresa" className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              <button onClick={crearEmpresa} disabled={saving} className={cn('btn-primary', saving && 'opacity-60')}>{saving ? 'Creando…' : 'Crear'}</button>
            </div>
            <div className="max-h-72 overflow-auto border border-zinc-700 rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Empresa</th><th className="text-left px-3 py-2">Estado</th><th className="text-left px-3 py-2">Acciones</th></tr></thead>
                <tbody>
                  {(empresas || []).map(e => (
                    <tr key={e.id} className="odd:bg-zinc-900/30">
                      <td className="px-3 py-2">{e.nombre}</td>
                      <td className="px-3 py-2">{e.is_active ? 'Activa' : 'Inactiva'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button onClick={() => setEmpresaSel(e.id)} className={cn('btn-ghost', empresaSel===e.id && 'ring-1 ring-blue-500')}>Seleccionar</button>
                          <button onClick={() => toggleEmpresaActiva(e)} className={cn('btn', e.is_active ? 'btn-warn' : 'btn-primary')}>{e.is_active ? 'Desactivar' : 'Activar'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {/* Zonas */}
        <Card title="Zonas">
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)} className="w-1/2 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
                <option value="">— Empresa —</option>
                {(empresas || []).map(e => (<option key={e.id} value={e.id}>{e.nombre}</option>))}
              </select>
              <input value={zonaNombre} onChange={e=>setZonaNombre(e.target.value)} placeholder="Nombre de zona" className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              <button onClick={crearZona} disabled={saving || !empresaSel} className={cn('btn-primary', (!empresaSel || saving) && 'opacity-60')}>Crear</button>
            </div>
            <div className="max-h-72 overflow-auto border border-zinc-700 rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Zona</th><th className="text-left px-3 py-2">Acciones</th></tr></thead>
                <tbody>
                  {(zonas || []).map(z => (
                    <tr key={z.id} className="odd:bg-zinc-900/30">
                      <td className="px-3 py-2">{z.nombre}</td>
                      <td className="px-3 py-2"><button onClick={()=>setZonaSel(z.id)} className={cn('btn-ghost', zonaSel===z.id && 'ring-1 ring-blue-500')}>Seleccionar</button></td>
                    </tr>
                  ))}
                  {empresaSel && (zonas || []).length===0 && <tr><td className="px-3 py-3 text-zinc-400" colSpan={2}>Sin zonas</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {/* Centros */}
        <Card title="Centros">
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2">
              <select value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
                <option value="">— Empresa —</option>
                {(empresas || []).map(e => (<option key={e.id} value={e.id}>{e.nombre}</option>))}
              </select>
              <select value={zonaSel} onChange={e=>setZonaSel(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500">
                <option value="">— Zona —</option>
                {(zonas || []).map(z => (<option key={z.id} value={z.id}>{z.nombre}</option>))}
              </select>
              <input value={centroNombre} onChange={e=>setCentroNombre(e.target.value)} placeholder="Nombre del centro" className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-300">Fecha inicio</label>
                <input type="date" value={centroFecha} onChange={e=>setCentroFecha(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 outline-none focus:border-zinc-500" />
              </div>
              <button onClick={crearCentro} disabled={saving || !zonaSel || !centroNombre.trim()} className={cn('btn-primary', (saving || !zonaSel || !centroNombre.trim()) && 'opacity-60')}>Crear centro</button>
            </div>

            <div className="max-h-72 overflow-auto border border-zinc-700 rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900/60"><tr><th className="text-left px-3 py-2">Centro</th><th className="text-left px-3 py-2">Inicio</th></tr></thead>
                <tbody>
                  {(centros || []).map(c => (
                    <tr key={c.id} className="odd:bg-zinc-900/30">
                      <td className="px-3 py-2">{c.nombre}</td>
                      <td className="px-3 py-2">{c.fecha_inicio || '—'}</td>
                    </tr>
                  ))}
                  {zonaSel && (centros || []).length===0 && <tr><td className="px-3 py-3 text-zinc-400" colSpan={2}>Sin centros</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

