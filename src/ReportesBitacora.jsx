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
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { (async () => {
    const { data } = await supabase.from('empresas').select('id, nombre').order('nombre')
    setEmpresas(data || []); if (data?.length) setEmpresaSel(data[0].id)
  })()}, [])

  useEffect(() => { (async () => {
    if (!empresaSel) { setZonas([]); setZonaSel(''); return }
    const { data } = await supabase.from('zonas').select('id, nombre').eq('empresa_id', empresaSel).order('nombre')
    setZonas(data || []); setZonaSel(data?.[0]?.id || '')
  })()}, [empresaSel])

  useEffect(() => { (async () => {
    if (!zonaSel) { setCentros([]); return }
    const { data } = await supabase.from('centros').select('id, nombre').eq('zona_id', zonaSel).order('nombre')
    setCentros(data || [])
  })()}, [zonaSel])

  const buscar = async () => {
    if (!zonaSel) return alert('Elige zona')
    if (!desde || !hasta) return alert('Elige rango de fechas')
    setLoading(true)
    const ids = centros.map(c=>c.id)
    if (!ids.length) { setRows([]); setLoading(false); return }

    const { data, error } = await supabase
      .from('bitacoras')
      .select('id, fecha, centro_id, piloto_id, estado_puerto, observaciones')
      .in('centro_id', ids)
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending:true })
    if (error) { alert(error.message); setLoading(false); return }

    // mapear nombres
    const pilotIds = [...new Set(data.map(r=>r.piloto_id).filter(Boolean))]
    let pilotos = []
    if (pilotIds.length) {
      const { data: pp } = await supabase.from('pilotos').select('id, nombre').in('id', pilotIds)
      pilotos = pp || []
    }
    const mapPiloto = (id) => pilotos.find(p=>p.id===id)?.nombre || ''
    const mapCentro = (id) => centros.find(c=>c.id===id)?.nombre || ''

    const rowsView = data.map(r => ({
      Fecha: r.fecha,
      Centro: mapCentro(r.centro_id),
      Piloto: mapPiloto(r.piloto_id),
      'Estado puerto': r.estado_puerto,
      Observaciones: r.observaciones || ''
    }))
    setRows(rowsView); setLoading(false)
  }

  const exportar = () => {
    if (!rows.length) return alert('No hay datos')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Bitacoras')
    XLSX.writeFile(wb, `bitacoras_${empresaSel}_${zonaSel}_${desde}_${hasta}.xlsx`)
  }

  return (
    <section style={box}>
      <h3>Reporte de Bitácoras (Excel) — por Empresa/Zona</h3>
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
        <button style={btn} onClick={exportar} disabled={!rows.length}>Exportar Excel</button>
      </div>

      {loading && <p>Cargando…</p>}
      {!!rows.length && (
        <table style={tbl}>
          <thead><tr>
            {Object.keys(rows[0]).map(k => <th key={k} style={thtd}>{k}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r,i)=>(
              <tr key={i}>
                {Object.values(r).map((v,j)=><td key={j} style={thtd}>{String(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !rows.length && <p>Sin resultados.</p>}
    </section>
  )
}
