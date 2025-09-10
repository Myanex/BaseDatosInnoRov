import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import * as XLSX from 'xlsx'

const box = { border:'1px solid #ddd', borderRadius:12, padding:16, margin:'16px 0', maxWidth:1200 }
const row = { display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:8 }
const btn = { padding:'8px 12px', border:'1px solid #bbb', borderRadius:8, cursor:'pointer' }
const input = { padding:8, border:'1px solid #bbb', borderRadius:8 }
const tbl = { width:'100%', borderCollapse:'collapse', marginTop:8 }
const thtd = { borderBottom:'1px solid #eee', padding:'6px 4px', textAlign:'left' }

export default function ReportesBitacora() {
  const [empresas, setEmpresas] = useState([])
  const [zonas, setZonas] = useState([])
  const [centros, setCentros] = useState([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [zonaSel, setZonaSel] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [rowsEnc, setRowsEnc] = useState([])
  const [loading, setLoading] = useState(false)

  // helpers
  const empresaName = empresas.find(e=>e.id===empresaSel)?.nombre || empresaSel
  const zonaName = zonas.find(z=>z.id===zonaSel)?.nombre || zonaSel

  useEffect(() => { (async () => {
    const { data } = await supabase.from('empresas').select('id, nombre').order('nombre')
    setEmpresas(data || []); if (data?.length) setEmpresaSel(data[0].id)
  })() }, [])

  useEffect(() => { (async () => {
    if (!empresaSel) { setZonas([]); setZonaSel(''); return }
    const { data } = await supabase.from('zonas').select('id, nombre').eq('empresa_id', empresaSel).order('nombre')
    setZonas(data || []); setZonaSel(data?.[0]?.id || '')
  })() }, [empresaSel])

  useEffect(() => { (async () => {
    if (!zonaSel) { setCentros([]); return }
    const { data } = await supabase.from('centros').select('id, nombre').eq('zona_id', zonaSel).order('nombre')
    setCentros(data || [])
  })() }, [zonaSel])

  const buscar = async () => {
    if (!zonaSel) return alert('Elige zona')
    if (!desde || !hasta) return alert('Elige rango de fechas')
    setLoading(true)
    try {
      const centroIds = centros.map(c=>c.id)
      if (!centroIds.length) { setRowsEnc([]); setLoading(false); return }

      // Encabezados de bitácora del rango y centros de la zona
      const { data: enc, error: e1 } = await supabase
        .from('bitacoras')
        .select('id, fecha, centro_id, piloto_id, estado_puerto, observaciones')
        .in('centro_id', centroIds)
        .gte('fecha', desde).lte('fecha', hasta)
        .order('fecha', { ascending: true })
      if (e1) throw e1

      // Mapear nombres de piloto
      const pilotIds = [...new Set(enc.map(r=>r.piloto_id).filter(Boolean))]
      let pilotos = []
      if (pilotIds.length) {
        const { data: pp } = await supabase.from('pilotos').select('id, nombre').in('id', pilotIds)
        pilotos = pp || []
      }
      const mapPiloto = (id) => pilotos.find(p=>p.id===id)?.nombre || ''
      const mapCentro  = (id) => centros.find(c=>c.id===id)?.nombre || ''

      // Vista para previsualizar y exportar
      const encView = enc.map(r => ({
        Fecha: r.fecha,
        Empresa: empresaName,
        Zona: zonaName,
        Centro: mapCentro(r.centro_id),
        Piloto: mapPiloto(r.piloto_id),
        'Estado puerto': r.estado_puerto,
        Observaciones: r.observaciones || ''
      }))
      setRowsEnc(encView)
    } catch (err) {
      alert(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  // utilidades Excel
  const toAutoWidth = (rows) => {
    if (!rows.length) return []
    const headers = Object.keys(rows[0])
    const colWidths = headers.map(h => Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length)))
    return colWidths.map(wch => ({ wch: Math.min(Math.max(wch + 2, 10), 40) })) // 10..40
  }

  const sheetNameSafeFactory = () => {
    const used = new Set()
    return (name) => {
      let s = String(name || 'Centro').replace(/[\\/?*\[\]:]/g, '_').slice(0, 31)
      if (!s) s = 'Centro'
      let base = s
      let i = 2
      while (used.has(s)) {
        const suffix = ` (${i++})`
        s = (base.slice(0, 31 - suffix.length) + suffix)
      }
      used.add(s)
      return s
    }
  }

  const exportarPorCentro = () => {
    if (!rowsEnc.length) return alert('No hay datos')

    // agrupar por centro
    const byCentro = rowsEnc.reduce((acc, r) => {
      const k = r.Centro || '(sin centro)'
      if (!acc[k]) acc[k] = []
      acc[k].push(r)
      return acc
    }, {})

    const wb = XLSX.utils.book_new()
    const safeName = sheetNameSafeFactory()

    Object.entries(byCentro).forEach(([centroNombre, rows]) => {
      if (!rows.length) return
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = toAutoWidth(rows)
      XLSX.utils.book_append_sheet(wb, ws, safeName(centroNombre))
    })

    const fname = `bitacoras_por_centro_${(empresaName||'empresa').replace(/\s+/g,'_')}_${(zonaName||'zona').replace(/\s+/g,'_')}_${desde}_${hasta}.xlsx`
    XLSX.writeFile(wb, fname)
  }

  return (
    <section style={box}>
      <h3>Reporte de Bitácoras — 1 hoja por Centro</h3>
      <div style={row}>
        <select style={input} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)}>
          {empresas.map(e=> <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select style={input} value={zonaSel} onChange={e=>setZonaSel(e.target.value)}>
          {zonas.map(z=> <option key={z.id} value={z.id}>{z.nombre}</option>)}
        </select>
        <input type="date" style={input} value={desde} onChange={e=>setDesde(e.target.value)} />
        <input type="date" style={input} value={hasta} onChange={e=>setHasta(e.target.value)} />
        <button style={btn} onClick={buscar}>Buscar</button>
        <button style={btn} onClick={exportarPorCentro} disabled={!rowsEnc.length}>Exportar (1 hoja por centro)</button>
      </div>

      {loading && <p>Cargando…</p>}

      {/* Vista previa rápida (muestra hasta 50 filas del total combinado) */}
      {!!rowsEnc.length && (
        <>
          <h4 style={{marginTop:12}}>Vista previa (combinada) — {rowsEnc.length} filas</h4>
          <table style={tbl}>
            <thead><tr>
              {Object.keys(rowsEnc[0]).map(k => <th key={k} style={thtd}>{k}</th>)}
            </tr></thead>
            <tbody>
              {rowsEnc.slice(0,50).map((r,i)=>(
                <tr key={i}>
                  {Object.values(r).map((v,j)=><td key={j} style={thtd}>{String(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rowsEnc.length > 50 && <p>Mostrando 50 de {rowsEnc.length}… (el Excel tendrá todo, separado por centro)</p>}
        </>
      )}

      {!loading && !rowsEnc.length && <p>Sin resultados.</p>}
    </section>
  )
}

