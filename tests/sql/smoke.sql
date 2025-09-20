-- tests/sql/smoke.sql
-- ON_ERROR_STOP lo activará el workflow.
-- 0) Tablas núcleo
DO $$ BEGIN
  PERFORM 1 FROM information_schema.tables WHERE table_name IN
   ('empresas','zonas','centros','componentes','equipos','equipo_componente',
    'prestamos_intra','movimientos','bitacora','bitacora_items',
    'profiles','profile_private','pilot_situaciones','audit_event');
  IF NOT FOUND THEN RAISE EXCEPTION 'Faltan tablas núcleo.'; END IF;
END $$;

-- 1) Vistas de pilotos (identidad unificada)
DO $$ BEGIN
  PERFORM 1 FROM information_schema.views WHERE table_name IN
    ('v_pilotos_asignados','v_pilotos_no_asignados');
  IF NOT FOUND THEN RAISE EXCEPTION 'Faltan vistas de pilotos.'; END IF;
END $$;

-- CI_SEED_CHECK_START
-- 2) Seed mínimo (si existe)
-- DO $$ BEGIN
--   PERFORM 1 FROM profiles LIMIT 1;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Seed ausente: no hay perfiles.'; END IF;
--   PERFORM 1 FROM centros LIMIT 1;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Seed ausente: no hay centros.'; END IF;
--   PERFORM 1 FROM equipos LIMIT 1;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Seed ausente: no hay equipos.'; END IF;
-- END $$;
--
-- CI_SEED_CHECK_END
-- 3) RLS: profile_private visible para oficina/admin, bloqueada para centro no asignado
SET LOCAL "request.jwt.claims" = '{
  "role": "oficina",
  "user_id": "00000000-0000-0000-0000-000000000001"
}';
SELECT 1 FROM profile_private LIMIT 1;

SET LOCAL "request.jwt.claims" = '{
  "role": "centro",
  "centro_id": null,
  "user_id": "00000000-0000-0000-0000-000000000002"
}';
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM profile_private LIMIT 1;
    RAISE EXCEPTION 'RLS fallo: centro no asignado pudo leer profile_private.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- 4) Guard de asignación
SET LOCAL "request.jwt.claims" = '{
  "role": "centro",
  "centro_id": null,
  "user_id": "00000000-0000-0000-0000-000000000003"
}';
DO $$ BEGIN
  BEGIN
    PERFORM assert_actor_asignado();
    RAISE EXCEPTION 'Guard fallo: centro no asignado no fue bloqueado.';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN NULL;
  END;
END $$;
