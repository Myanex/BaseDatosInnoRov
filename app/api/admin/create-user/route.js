import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.warn('Faltan variables: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
}

const admin = createClient(url, serviceRoleKey)

export async function POST(req) {
  try {
    const body = await req.json()
    const { nombre, email, rutBody, rol, centroId } = body || {}

    // Validaciones simples
    if (!email || !nombre || !rutBody || !rol) {
      return NextResponse.json({ error: 'Faltan campos: nombre, email, rut y rol' }, { status: 400 })
    }
    if (!['centro','oficina','admin'].includes(rol)) {
      return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
    }

    // 1) Crear usuario en Auth con clave = rutBody y email confirmado
    const { data: created, error: eCreate } = await admin.auth.admin.createUser({
      email,
      password: String(rutBody),
      email_confirm: true,
      user_metadata: { nombre, rut: String(rutBody), rol }
    })
    if (eCreate) return NextResponse.json({ error: eCreate.message }, { status: 400 })

    const user = created?.user
    if (!user?.id) return NextResponse.json({ error: 'No se obtuvo user.id' }, { status: 500 })

    // 2) Insertar profile
    const { error: eProfile } = await admin.from('profiles').insert({
      user_id: user.id,
      nombre,
      rut: String(rutBody),
      rol,
      must_change_password: true,
      is_active: true
      // sin centro aquí; “en reserva” por defecto
    })
    if (eProfile) return NextResponse.json({ error: eProfile.message }, { status: 400 })

    // 3) Si es operario y trae centro, transferirlo (sino, queda en reserva)
    if (rol === 'centro' && centroId) {
      const { error: eRpc } = await admin.rpc('rpc_transferir_usuario_definitivo', {
        p_user_id: user.id,
        p_nuevo_centro_id: centroId,
        p_fecha_inicio: null
      })
      if (eRpc) return NextResponse.json({ error: `Usuario creado pero no se pudo asignar centro: ${eRpc.message}` }, { status: 200 })
    }

    return NextResponse.json({ ok: true, user_id: user.id }, { status: 200 })
  } catch (err) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
