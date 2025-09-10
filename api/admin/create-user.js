// /api/admin/create-user.js  (Vercel Serverless Function para proyectos Vite/React)
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Cliente con Service Role (solo en servidor)
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { nombre, email, rutBody, rol, centroId } = body

    // Validaciones
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Faltan variables SUPABASE en el servidor' })
    }
    if (!email || !nombre || !rutBody || !rol) {
      return res.status(400).json({ error: 'Faltan campos: nombre, email, rut y rol' })
    }
    if (!['centro', 'oficina', 'admin'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' })
    }

    // 1) Crear usuario en Auth (clave = RUT sin DV)
    const { data: created, error: eCreate } = await admin.auth.admin.createUser({
      email,
      password: String(rutBody),
      email_confirm: true,
      user_metadata: { nombre, rut: String(rutBody), rol }
    })
    if (eCreate) return res.status(400).json({ error: eCreate.message })

    const user = created?.user
    if (!user?.id) return res.status(500).json({ error: 'No se obtuvo user.id' })

    // 2) Insertar profile (en reserva por defecto: sin centro/empresa/zona)
    const { error: eProfile } = await admin.from('profiles').insert({
      user_id: user.id,
      nombre,
      rut: String(rutBody),
      rol,
      must_change_password: true,
      is_active: true
      // sin centro_id / empresa_id / zona_id
    })
    if (eProfile) return res.status(400).json({ error: eProfile.message })

    // 3) Si es operario y trae centro, transferirlo (si no, queda en reserva)
    if (rol === 'centro' && centroId) {
      const { error: eRpc } = await admin.rpc('rpc_transferir_usuario_definitivo', {
        p_user_id: user.id,
        p_nuevo_centro_id: centroId,
        p_fecha_inicio: null
      })

      // Si la RPC falla, no rompemos la creación; devolvemos warning
      if (eRpc) {
        return res.status(200).json({
          ok: true,
          user_id: user.id,
          warning: 'Usuario creado pero no se pudo asignar centro: ' + eRpc.message
        })
      }
    }

    return res.status(200).json({ ok: true, user_id: user.id })
  } catch (err) {
    // Siempre devolver JSON para que el front no “falle al parsear”
    return res.status(500).json({ error: err?.message || String(err) })
  }
}
