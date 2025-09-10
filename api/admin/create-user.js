import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const sAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { nombre, email, rutBody, rol, centroId } = req.body || {};
    if (!nombre || !email || !rutBody || !rol || !centroId) {
      return res.status(400).json({ error: 'Faltan campos' });
    }

    // 1) Crear usuario en Auth (password inicial = RUT sin DV)
    const { data: authRes, error: eAuth } = await sAdmin.auth.admin.createUser({
      email, password: String(rutBody), email_confirm: true, user_metadata: { rut_body: rutBody }
    });
    if (eAuth || !authRes?.user) return res.status(400).json({ error: eAuth?.message || 'No se pudo crear usuario' });
    const userId = authRes.user.id;

    // 2) Perfil
    const { error: eProf } = await sAdmin.from('profiles').insert({
      user_id: userId, nombre, correo: email, rol, estado: true, must_change_password: true, rut: String(rutBody)
    });
    if (eProf) {
      await sAdmin.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: eProf.message });
    }

    // 3) Asignación inicial
    const { error: eAsg } = await sAdmin
      .from('user_centro_asignacion')
      .insert({ user_id: userId, centro_id: centroId, es_temporal: false });
    if (eAsg) {
      await sAdmin.auth.admin.deleteUser(userId);
      await sAdmin.from('profiles').delete().eq('user_id', userId);
      return res.status(400).json({ error: eAsg.message });
    }

    return res.status(201).json({ ok: true, userId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
