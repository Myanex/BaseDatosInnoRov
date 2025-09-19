-- Migración: Identidades unificadas y esqueleto de asignación de pilotos
-- Contexto: Proyecto Sistema de Gestión ROV (Supabase)
-- EDI: Greenfield — se detectarán objetos previos y se recrearán con seguridad.

BEGIN;

-- Adquiere candado para evitar condiciones de carrera durante la migración
SELECT pg_advisory_xact_lock(hashtext('migrations:0001_identidades_unificadas'));

-- ============================================================
-- 1. Esquema utilitario y helpers de verificación (app_meta)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS app_meta;

-- Limpieza previa de funciones para asegurar idempotencia
DROP FUNCTION IF EXISTS app_meta.assert_table(text, text);
CREATE FUNCTION app_meta.assert_table(p_schema text, p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_regclass regclass;
BEGIN
    SELECT to_regclass(format('%I.%I', p_schema, p_table)) INTO v_regclass;
    IF v_regclass IS NULL THEN
        RAISE EXCEPTION 'Tabla no encontrada: %.%', p_schema, p_table;
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS app_meta.assert_column(text, text, text);
CREATE FUNCTION app_meta.assert_column(p_schema text, p_table text, p_column text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_exists boolean;
BEGIN
    SELECT TRUE
    FROM information_schema.columns
    WHERE table_schema = p_schema
      AND table_name = p_table
      AND column_name = p_column
    INTO v_exists;

    IF NOT COALESCE(v_exists, FALSE) THEN
        RAISE EXCEPTION 'Columna no encontrada: %.%.%', p_schema, p_table, p_column;
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS app_meta.assert_rls_enabled(text, text);
CREATE FUNCTION app_meta.assert_rls_enabled(p_schema text, p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_schema
      AND c.relname = p_table
    INTO v_enabled;

    IF NOT COALESCE(v_enabled, FALSE) THEN
        RAISE EXCEPTION 'RLS deshabilitado en %.%', p_schema, p_table;
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS app_meta.get_jwt_claim_text(text);
CREATE FUNCTION app_meta.get_jwt_claim_text(key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_claims jsonb;
    v_value text;
BEGIN
    v_claims := auth.jwt();
    IF v_claims IS NULL THEN
        RETURN NULL;
    END IF;

    v_value := v_claims ->> key;
    IF v_value IS NULL OR length(trim(v_value)) = 0 THEN
        RETURN NULL;
    END IF;

    RETURN v_value;
END;
$$;

DROP FUNCTION IF EXISTS app_meta.assert_claim(text);
CREATE FUNCTION app_meta.assert_claim(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_value text;
BEGIN
    v_value := app_meta.get_jwt_claim_text(p_key);
    IF v_value IS NULL THEN
        RAISE EXCEPTION 'Sesión inválida: falta claim ''%''.', p_key
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

-- ============================================================
-- 2. Enum de roles unificados
-- ============================================================
DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'role_enum'
          AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.role_enum AS ENUM ('admin', 'oficina', 'centro');
    ELSE
        -- EDI: Se detectó role_enum existente; validar que cuente con todos los valores requeridos.
        SELECT val
        INTO v_missing
        FROM unnest(ARRAY['admin', 'oficina', 'centro']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            WHERE e.enumtypid = 'public.role_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;

        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'role_enum existente carece del valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

-- ============================================================
-- 3. Tabla profiles (identidad unificada)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.role_enum NOT NULL,
    centro_id uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- EDI: La FK hacia centros.id se añadirá cuando la tabla centros exista en el esquema final.

-- Trigger para updated_at
DROP FUNCTION IF EXISTS public.trg_profiles_set_updated_at();
CREATE FUNCTION public.trg_profiles_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_profiles_set_updated_at();

-- Índices operativos
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);
CREATE INDEX IF NOT EXISTS profiles_centro_id_idx ON public.profiles(centro_id);

-- ============================================================
-- 4. Vistas derivadas para pilotos asignados/no asignados
-- ============================================================
DROP VIEW IF EXISTS public.v_pilotos_asignados;
CREATE VIEW public.v_pilotos_asignados AS
SELECT p.user_id,
       p.role,
       p.centro_id,
       p.created_at,
       p.updated_at
FROM public.profiles p
WHERE p.role = 'centro'::public.role_enum
  AND p.centro_id IS NOT NULL;

DROP VIEW IF EXISTS public.v_pilotos_no_asignados;
CREATE VIEW public.v_pilotos_no_asignados AS
SELECT p.user_id,
       p.role,
       p.centro_id,
       p.created_at,
       p.updated_at
FROM public.profiles p
WHERE p.role = 'centro'::public.role_enum
  AND p.centro_id IS NULL;

-- ============================================================
-- 5. Funciones de sesión y RPCs auxiliares
-- ============================================================
DROP FUNCTION IF EXISTS public.v_sesion();
CREATE FUNCTION public.v_sesion()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
BEGIN
    PERFORM app_meta.assert_claim('role');

    SELECT p.*
    INTO v_profile
    FROM public.profiles p
    WHERE p.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sesión inválida: perfil no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_profile;
END;
$$;

DROP FUNCTION IF EXISTS public.assert_actor_asignado();
CREATE FUNCTION public.assert_actor_asignado()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_current public.profiles%ROWTYPE;
BEGIN
    v_current := public.v_sesion();

    IF v_current.role = 'centro'::public.role_enum AND v_current.centro_id IS NULL THEN
        RAISE EXCEPTION 'Operación no disponible: no estás asignado a un centro.'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

-- EDI: Esta función deberá invocarse en RPCs de bitácora, préstamos intra-centro y movimientos de confirmación.

DROP FUNCTION IF EXISTS public.rpc_guard_op(text);
CREATE FUNCTION public.rpc_guard_op(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_current public.profiles%ROWTYPE;
BEGIN
    v_current := public.v_sesion();
    -- EDI: Guardado de auditoría pendiente. Registrar v_current.user_id, v_current.role, v_current.centro_id y p_name cuando se defina tabla de auditoría.
    PERFORM 1;
END;
$$;

-- ============================================================
-- 6. RLS sobre profiles
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_admin_oficina ON public.profiles;
CREATE POLICY profiles_select_admin_oficina
ON public.profiles
FOR SELECT
USING ((public.v_sesion()).role IN ('admin'::public.role_enum, 'oficina'::public.role_enum));

DROP POLICY IF EXISTS profiles_select_centro_self ON public.profiles;
CREATE POLICY profiles_select_centro_self
ON public.profiles
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'::public.role_enum
    AND (public.v_sesion()).user_id = profiles.user_id
);

DROP POLICY IF EXISTS profiles_insert_admin_oficina ON public.profiles;
CREATE POLICY profiles_insert_admin_oficina
ON public.profiles
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin'::public.role_enum, 'oficina'::public.role_enum));

DROP POLICY IF EXISTS profiles_update_admin_oficina ON public.profiles;
CREATE POLICY profiles_update_admin_oficina
ON public.profiles
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin'::public.role_enum, 'oficina'::public.role_enum))
WITH CHECK ((public.v_sesion()).role IN ('admin'::public.role_enum, 'oficina'::public.role_enum));

-- EDI: Pilotos (role = centro) no podrán modificar role/centro_id desde SQL directo; se hará mediante RPCs autorizadas.

-- ============================================================
-- 7. Dataset demo opcional (idempotente)
-- ============================================================
DO $$
DECLARE
    v_admin uuid;
    v_oficina uuid;
    v_centro uuid;
    v_piloto_asignado uuid;
    v_piloto_no_asignado uuid;
BEGIN
    -- EDI: Semilla opcional. Los usuarios deben existir previamente en auth.users.
    SELECT id INTO v_admin FROM auth.users WHERE email = 'admin@demo.local';
    IF FOUND THEN
        INSERT INTO public.profiles (user_id, role, centro_id)
        SELECT v_admin, 'admin'::public.role_enum, NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_admin);
    END IF;

    SELECT id INTO v_oficina FROM auth.users WHERE email = 'oficina@demo.local';
    IF FOUND THEN
        INSERT INTO public.profiles (user_id, role, centro_id)
        SELECT v_oficina, 'oficina'::public.role_enum, NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_oficina);
    END IF;

    IF to_regclass('public.centros') IS NULL THEN
        -- EDI: No existe la tabla public.centros aún; se omite la semilla de pilotos asignados.
        RETURN;
    END IF;

    SELECT id INTO v_centro FROM public.centros LIMIT 1;
    IF NOT FOUND THEN
        -- EDI: No hay centros cargados. Semilla de pilotos asignados requiere centros existentes.
        RETURN;
    END IF;

    SELECT id INTO v_piloto_asignado FROM auth.users WHERE email = 'piloto.asignado@demo.local';
    IF FOUND THEN
        INSERT INTO public.profiles (user_id, role, centro_id)
        SELECT v_piloto_asignado, 'centro'::public.role_enum, v_centro
        WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_piloto_asignado);
    END IF;

    SELECT id INTO v_piloto_no_asignado FROM auth.users WHERE email = 'piloto.noasignado@demo.local';
    IF FOUND THEN
        INSERT INTO public.profiles (user_id, role, centro_id)
        SELECT v_piloto_no_asignado, 'centro'::public.role_enum, NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_piloto_no_asignado);
    END IF;
END;
$$;

-- ============================================================
-- 8. Bloque de pruebas smoke (comentado)
-- ============================================================
--
-- -- Smoke: vistas de pilotos
-- -- select * from public.v_pilotos_asignados;
-- -- select * from public.v_pilotos_no_asignados;
--
-- -- Smoke: RLS perfiles (reemplazar <jwt> con claims apropiadas)
-- -- set local role to none; -- placeholder para aislar sesión
-- -- comment on future tests to emulate roles mediante set_config('request.jwt.claim.role', ...)
--
-- -- Smoke: RPC assert_actor_asignado
-- -- select public.assert_actor_asignado(); -- debe fallar si el usuario es piloto sin centro
--
-- ============================================================
-- 9. TODOs y notas de seguimiento
-- ============================================================
-- EDI: Agregar constraint FK profiles.centro_id → centros.id cuando la tabla centros esté disponible.
-- EDI: Implementar RLS y policies en tablas operativas (inventario, bitácora, préstamos, movimientos).
-- EDI: Inyectar public.assert_actor_asignado() en RPCs operativas (bitácora, préstamos intra-centro, confirmar recepción).
-- EDI: Definir tabla de auditoría para rpc_guard_op.

COMMIT;
