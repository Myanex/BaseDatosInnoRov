-- Migración: Políticas RLS y RPCs operativas con identidad unificada
-- Contexto: Proyecto Sistema de Gestión ROV (Supabase)
-- EDI: Implementa controles de acceso, guards y lógica de negocio solicitada en Prompt 3.

BEGIN;

-- Adquiere candado para evitar condiciones de carrera durante la migración
SELECT pg_advisory_xact_lock(hashtext('migrations:0003_rls_rpcs'));

-- ============================================================
-- 0. Ajustes de enums y columnas auxiliares
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'ubicacion_enum'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            WHERE e.enumtypid = 'public.ubicacion_enum'::regtype
              AND e.enumlabel = 'asignado_a_equipo'
        ) THEN
            ALTER TYPE public.ubicacion_enum ADD VALUE 'asignado_a_equipo';
        END IF;
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'condicion_enum'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            WHERE e.enumtypid = 'public.condicion_enum'::regtype
              AND e.enumlabel = 'baja'
        ) THEN
            ALTER TYPE public.condicion_enum ADD VALUE 'baja';
        END IF;
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'movimiento_tipo_enum'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            WHERE e.enumtypid = 'public.movimiento_tipo_enum'::regtype
              AND e.enumlabel = 'baja'
        ) THEN
            ALTER TYPE public.movimiento_tipo_enum ADD VALUE 'baja';
        END IF;
    END IF;
END;
$$;

-- Columnas auxiliares para bajas lógicas de componentes
ALTER TABLE public.componentes
    ADD COLUMN IF NOT EXISTS fecha_baja_logica timestamptz,
    ADD COLUMN IF NOT EXISTS motivo_baja_logica text;

-- Columnas para fechas específicas de préstamos
ALTER TABLE public.prestamos_intra
    ADD COLUMN IF NOT EXISTS fecha_devuelto timestamptz,
    ADD COLUMN IF NOT EXISTS fecha_definitivo timestamptz;

-- Columnas de detalle de movimientos
ALTER TABLE public.movimientos
    ADD COLUMN IF NOT EXISTS origen_detalle text,
    ADD COLUMN IF NOT EXISTS destino_detalle text;

-- ============================================================
-- 1. Helper de sesión y guards de rol
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'session_context'
    ) THEN
        CREATE TYPE public.session_context AS (
            user_id uuid,
            role public.role_enum,
            centro_id uuid,
            empresa_id uuid
        );
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.v_sesion();
CREATE FUNCTION public.v_sesion()
RETURNS public.session_context
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_claim_user text;
    v_claim_role text;
    v_claim_centro text;
    v_claim_empresa text;
    v_profile public.profiles%ROWTYPE;
    v_ctx public.session_context;
    v_centro_empresa uuid;
BEGIN
    v_claim_user := app_meta.get_jwt_claim_text('user_id');
    IF v_claim_user IS NOT NULL THEN
        v_ctx.user_id := v_claim_user::uuid;
    ELSE
        v_ctx.user_id := auth.uid();
    END IF;

    IF v_ctx.user_id IS NULL THEN
        RAISE EXCEPTION 'Sesión inválida: user_id no disponible.' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.*
    INTO v_profile
    FROM public.profiles p
    WHERE p.user_id = v_ctx.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sesión inválida: perfil no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    v_claim_role := app_meta.get_jwt_claim_text('role');
    IF v_claim_role IS NOT NULL THEN
        v_ctx.role := v_claim_role::public.role_enum;
    ELSE
        v_ctx.role := v_profile.role;
    END IF;
    IF v_ctx.role IS DISTINCT FROM v_profile.role THEN
        v_ctx.role := v_profile.role;
    END IF;

    v_claim_centro := app_meta.get_jwt_claim_text('centro_id');
    IF v_profile.centro_id IS NOT NULL THEN
        v_ctx.centro_id := v_profile.centro_id;
    ELSIF v_claim_centro IS NOT NULL THEN
        v_ctx.centro_id := v_claim_centro::uuid;
    ELSE
        v_ctx.centro_id := NULL;
    END IF;

    IF v_ctx.centro_id IS NOT NULL THEN
        SELECT c.empresa_id INTO v_centro_empresa
        FROM public.centros c
        WHERE c.id = v_ctx.centro_id;
    ELSE
        v_centro_empresa := NULL;
    END IF;

    v_claim_empresa := app_meta.get_jwt_claim_text('empresa_id');
    IF v_claim_empresa IS NOT NULL THEN
        v_ctx.empresa_id := v_claim_empresa::uuid;
    ELSE
        v_ctx.empresa_id := v_centro_empresa;
    END IF;

    RETURN v_ctx;
END;
$$;

DROP FUNCTION IF EXISTS public.assert_admin_dev();
CREATE FUNCTION public.assert_admin_dev()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    IF v_ctx.role NOT IN ('admin', 'dev') THEN
        RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.assert_oficina();
CREATE FUNCTION public.assert_oficina()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    IF v_ctx.role NOT IN ('admin', 'dev', 'oficina') THEN
        RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
    END IF;
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
    v_ctx public.session_context;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    IF v_ctx.role = 'centro' AND v_ctx.centro_id IS NULL THEN
        RAISE EXCEPTION 'Operación no disponible: no estás asignado a un centro.' USING ERRCODE = '42501';
    END IF;
END;
$$;

-- ============================================================
-- 2. Función de auditoría utilitaria
-- ============================================================
DROP FUNCTION IF EXISTS public.audit_event(uuid, public.role_enum, uuid, text, text, jsonb);
CREATE FUNCTION public.audit_event(
    p_who_user_id uuid,
    p_role public.role_enum,
    p_centro_id uuid,
    p_objeto text,
    p_accion text,
    p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
BEGIN
    INSERT INTO public.audit_event (who_user_id, role, centro_id, objeto_tipo, accion, payload)
    VALUES (p_who_user_id, p_role, p_centro_id, p_objeto, p_accion, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_guard_op(text);
CREATE FUNCTION public.rpc_guard_op(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    PERFORM public.audit_event(v_ctx.user_id, v_ctx.role, v_ctx.centro_id, 'guard', p_name, '{}'::jsonb);
END;
$$;

-- ============================================================
-- 3. Políticas RLS por dominio
-- ============================================================
-- 3.1 Organización
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empresas_select_admin_dev ON public.empresas;
DROP POLICY IF EXISTS empresas_select_oficina ON public.empresas;
DROP POLICY IF EXISTS empresas_select_centro ON public.empresas;
DROP POLICY IF EXISTS empresas_modify_admin_dev ON public.empresas;
DROP POLICY IF EXISTS empresas_delete_admin_dev ON public.empresas;

CREATE POLICY empresas_select_admin_dev
ON public.empresas
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY empresas_select_oficina
ON public.empresas
FOR SELECT
USING ((public.v_sesion()).role = 'oficina');

CREATE POLICY empresas_select_centro
ON public.empresas
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (public.v_sesion()).empresa_id IS NOT NULL
    AND public.empresas.id = (public.v_sesion()).empresa_id
);

CREATE POLICY empresas_modify_admin_dev
ON public.empresas
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY empresas_delete_admin_dev
ON public.empresas
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev'));

ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zonas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zonas_select_admin_dev ON public.zonas;
DROP POLICY IF EXISTS zonas_select_oficina ON public.zonas;
DROP POLICY IF EXISTS zonas_select_centro ON public.zonas;
DROP POLICY IF EXISTS zonas_modify_admin_dev ON public.zonas;
DROP POLICY IF EXISTS zonas_delete_admin_dev ON public.zonas;

CREATE POLICY zonas_select_admin_dev
ON public.zonas
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY zonas_select_oficina
ON public.zonas
FOR SELECT
USING ((public.v_sesion()).role = 'oficina');

CREATE POLICY zonas_select_centro
ON public.zonas
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (public.v_sesion()).empresa_id IS NOT NULL
    AND public.zonas.empresa_id = (public.v_sesion()).empresa_id
);

CREATE POLICY zonas_modify_admin_dev
ON public.zonas
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY zonas_delete_admin_dev
ON public.zonas
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev'));

ALTER TABLE public.centros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.centros FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS centros_select_admin_dev ON public.centros;
DROP POLICY IF EXISTS centros_select_oficina ON public.centros;
DROP POLICY IF EXISTS centros_select_centro ON public.centros;
DROP POLICY IF EXISTS centros_modify_admin_dev ON public.centros;
DROP POLICY IF EXISTS centros_delete_admin_dev ON public.centros;

CREATE POLICY centros_select_admin_dev
ON public.centros
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY centros_select_oficina
ON public.centros
FOR SELECT
USING ((public.v_sesion()).role = 'oficina');

CREATE POLICY centros_select_centro
ON public.centros
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (
        public.centros.id = (public.v_sesion()).centro_id
        OR (
            (public.v_sesion()).empresa_id IS NOT NULL
            AND public.centros.empresa_id = (public.v_sesion()).empresa_id
        )
    )
);

CREATE POLICY centros_modify_admin_dev
ON public.centros
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY centros_delete_admin_dev
ON public.centros
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev'));

-- 3.2 Identidad y datos sensibles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select_admin_oficina ON public.profiles;
DROP POLICY IF EXISTS profiles_select_centro_self ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_admin_oficina ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin_oficina ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_admin_dev ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin_dev ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_admin_dev ON public.profiles;

CREATE POLICY profiles_select_admin_dev_oficina
ON public.profiles
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY profiles_select_centro_self
ON public.profiles
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).user_id = public.profiles.user_id
);

CREATE POLICY profiles_insert_admin_dev
ON public.profiles
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY profiles_update_admin_dev
ON public.profiles
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin', 'dev'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev'));

CREATE POLICY profiles_delete_admin_dev
ON public.profiles
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev'));

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_private FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_private_select_staff ON public.profile_private;
DROP POLICY IF EXISTS profile_private_modify_staff ON public.profile_private;
DROP POLICY IF EXISTS profile_private_delete_staff ON public.profile_private;

CREATE POLICY profile_private_select_staff
ON public.profile_private
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY profile_private_modify_staff
ON public.profile_private
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY profile_private_delete_staff
ON public.profile_private
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

ALTER TABLE public.pilot_situaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_situaciones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pilot_situaciones_select_staff ON public.pilot_situaciones;
DROP POLICY IF EXISTS pilot_situaciones_select_self ON public.pilot_situaciones;
DROP POLICY IF EXISTS pilot_situaciones_modify_staff ON public.pilot_situaciones;
DROP POLICY IF EXISTS pilot_situaciones_delete_staff ON public.pilot_situaciones;

CREATE POLICY pilot_situaciones_select_staff
ON public.pilot_situaciones
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY pilot_situaciones_select_self
ON public.pilot_situaciones
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).user_id = public.pilot_situaciones.user_id
);

CREATE POLICY pilot_situaciones_modify_staff
ON public.pilot_situaciones
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY pilot_situaciones_delete_staff
ON public.pilot_situaciones
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

-- 3.3 Inventario
ALTER TABLE public.componentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.componentes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS componentes_select_staff ON public.componentes;
DROP POLICY IF EXISTS componentes_select_centro ON public.componentes;
DROP POLICY IF EXISTS componentes_insert_staff ON public.componentes;
DROP POLICY IF EXISTS componentes_update_staff ON public.componentes;
DROP POLICY IF EXISTS componentes_delete_staff ON public.componentes;

CREATE POLICY componentes_select_staff
ON public.componentes
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY componentes_select_centro
ON public.componentes
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.componentes.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY componentes_insert_staff
ON public.componentes
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY componentes_update_staff
ON public.componentes
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY componentes_delete_staff
ON public.componentes
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipos_select_staff ON public.equipos;
DROP POLICY IF EXISTS equipos_select_centro ON public.equipos;
DROP POLICY IF EXISTS equipos_insert_staff ON public.equipos;
DROP POLICY IF EXISTS equipos_update_staff ON public.equipos;
DROP POLICY IF EXISTS equipos_delete_staff ON public.equipos;

CREATE POLICY equipos_select_staff
ON public.equipos
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY equipos_select_centro
ON public.equipos
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.equipos.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY equipos_insert_staff
ON public.equipos
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY equipos_update_staff
ON public.equipos
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY equipos_delete_staff
ON public.equipos
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

ALTER TABLE public.equipo_componente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipo_componente FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipo_componente_select_staff ON public.equipo_componente;
DROP POLICY IF EXISTS equipo_componente_select_centro ON public.equipo_componente;
DROP POLICY IF EXISTS equipo_componente_modify_staff ON public.equipo_componente;
DROP POLICY IF EXISTS equipo_componente_delete_staff ON public.equipo_componente;

CREATE POLICY equipo_componente_select_staff
ON public.equipo_componente
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY equipo_componente_select_centro
ON public.equipo_componente
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM public.equipos eq
        WHERE eq.id = public.equipo_componente.equipo_id
          AND eq.centro_id = (public.v_sesion()).centro_id
    )
);

CREATE POLICY equipo_componente_modify_staff
ON public.equipo_componente
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY equipo_componente_delete_staff
ON public.equipo_componente
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

-- 3.4 Préstamos intra-centro
ALTER TABLE public.prestamos_intra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prestamos_intra FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prestamos_intra_select_staff ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_intra_select_centro ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_intra_insert_staff ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_intra_insert_centro ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_intra_update_staff ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_intra_update_centro ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_intra_delete_staff ON public.prestamos_intra;

CREATE POLICY prestamos_intra_select_staff
ON public.prestamos_intra
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY prestamos_intra_select_centro
ON public.prestamos_intra
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (
        public.prestamos_intra.centro_id = (public.v_sesion()).centro_id
        OR EXISTS (
            SELECT 1
            FROM public.equipos eq
            WHERE eq.id = public.prestamos_intra.equipo_destino_id
              AND eq.centro_id = (public.v_sesion()).centro_id
        )
    )
);

CREATE POLICY prestamos_intra_insert_staff
ON public.prestamos_intra
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY prestamos_intra_insert_centro
ON public.prestamos_intra
FOR INSERT
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.prestamos_intra.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY prestamos_intra_update_staff
ON public.prestamos_intra
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY prestamos_intra_update_centro
ON public.prestamos_intra
FOR UPDATE
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.prestamos_intra.centro_id = (public.v_sesion()).centro_id
)
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.prestamos_intra.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY prestamos_intra_delete_staff
ON public.prestamos_intra
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

-- 3.5 Movimientos operativos
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movimientos_select_staff ON public.movimientos;
DROP POLICY IF EXISTS movimientos_select_centro ON public.movimientos;
DROP POLICY IF EXISTS movimientos_insert_staff ON public.movimientos;
DROP POLICY IF EXISTS movimientos_insert_centro ON public.movimientos;
DROP POLICY IF EXISTS movimientos_update_staff ON public.movimientos;
DROP POLICY IF EXISTS movimientos_update_centro ON public.movimientos;
DROP POLICY IF EXISTS movimientos_delete_staff ON public.movimientos;

CREATE POLICY movimientos_select_staff
ON public.movimientos
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY movimientos_select_centro
ON public.movimientos
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (
        public.movimientos.centro_origen_id = (public.v_sesion()).centro_id
        OR public.movimientos.centro_destino_id = (public.v_sesion()).centro_id
    )
);

CREATE POLICY movimientos_insert_staff
ON public.movimientos
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY movimientos_insert_centro
ON public.movimientos
FOR INSERT
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.movimientos.centro_origen_id = (public.v_sesion()).centro_id
);

CREATE POLICY movimientos_update_staff
ON public.movimientos
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY movimientos_update_centro
ON public.movimientos
FOR UPDATE
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (
        public.movimientos.centro_origen_id = (public.v_sesion()).centro_id
        OR (
            public.movimientos.centro_destino_id = (public.v_sesion()).centro_id
            AND public.movimientos.destino_tipo <> 'reparacion_externa'
        )
    )
)
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND (
        public.movimientos.centro_origen_id = (public.v_sesion()).centro_id
        OR (
            public.movimientos.centro_destino_id = (public.v_sesion()).centro_id
            AND public.movimientos.destino_tipo <> 'reparacion_externa'
        )
    )
);

CREATE POLICY movimientos_delete_staff
ON public.movimientos
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

-- 3.6 Bitácora operativa
ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bitacora_select_staff ON public.bitacora;
DROP POLICY IF EXISTS bitacora_select_centro ON public.bitacora;
DROP POLICY IF EXISTS bitacora_insert_staff ON public.bitacora;
DROP POLICY IF EXISTS bitacora_insert_centro ON public.bitacora;
DROP POLICY IF EXISTS bitacora_update_staff ON public.bitacora;
DROP POLICY IF EXISTS bitacora_update_centro ON public.bitacora;
DROP POLICY IF EXISTS bitacora_delete_staff ON public.bitacora;

CREATE POLICY bitacora_select_staff
ON public.bitacora
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY bitacora_select_centro
ON public.bitacora
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.bitacora.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY bitacora_insert_staff
ON public.bitacora
FOR INSERT
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY bitacora_insert_centro
ON public.bitacora
FOR INSERT
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.bitacora.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY bitacora_update_staff
ON public.bitacora
FOR UPDATE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY bitacora_update_centro
ON public.bitacora
FOR UPDATE
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.bitacora.centro_id = (public.v_sesion()).centro_id
)
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND public.bitacora.centro_id = (public.v_sesion()).centro_id
);

CREATE POLICY bitacora_delete_staff
ON public.bitacora
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

ALTER TABLE public.bitacora_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bitacora_items_select_staff ON public.bitacora_items;
DROP POLICY IF EXISTS bitacora_items_select_centro ON public.bitacora_items;
DROP POLICY IF EXISTS bitacora_items_modify_staff ON public.bitacora_items;
DROP POLICY IF EXISTS bitacora_items_modify_centro ON public.bitacora_items;
DROP POLICY IF EXISTS bitacora_items_delete_staff ON public.bitacora_items;

CREATE POLICY bitacora_items_select_staff
ON public.bitacora_items
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY bitacora_items_select_centro
ON public.bitacora_items
FOR SELECT
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM public.bitacora b
        WHERE b.id = public.bitacora_items.bitacora_id
          AND b.centro_id = (public.v_sesion()).centro_id
    )
);

CREATE POLICY bitacora_items_modify_staff
ON public.bitacora_items
FOR ALL
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'))
WITH CHECK ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY bitacora_items_modify_centro
ON public.bitacora_items
FOR ALL
USING (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM public.bitacora b
        WHERE b.id = public.bitacora_items.bitacora_id
          AND b.centro_id = (public.v_sesion()).centro_id
    )
)
WITH CHECK (
    (public.v_sesion()).role = 'centro'
    AND (public.v_sesion()).centro_id IS NOT NULL
    AND EXISTS (
        SELECT 1
        FROM public.bitacora b
        WHERE b.id = public.bitacora_items.bitacora_id
          AND b.centro_id = (public.v_sesion()).centro_id
    )
);

CREATE POLICY bitacora_items_delete_staff
ON public.bitacora_items
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

-- 3.7 Auditoría
ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_event_select_staff ON public.audit_event;
DROP POLICY IF EXISTS audit_event_insert_any ON public.audit_event;
DROP POLICY IF EXISTS audit_event_delete_staff ON public.audit_event;

CREATE POLICY audit_event_select_staff
ON public.audit_event
FOR SELECT
USING ((public.v_sesion()).role IN ('admin', 'dev', 'oficina'));

CREATE POLICY audit_event_insert_any
ON public.audit_event
FOR INSERT
WITH CHECK (true);

CREATE POLICY audit_event_delete_staff
ON public.audit_event
FOR DELETE
USING ((public.v_sesion()).role IN ('admin', 'dev'));

-- ============================================================
-- 4. RPCs críticas con validaciones de negocio
-- ============================================================
DROP FUNCTION IF EXISTS public.rpc_equipo_crear(text, text, uuid, uuid, public.operatividad_enum, public.condicion_enum, public.equipo_rol_enum, public.ubicacion_enum, text);
CREATE FUNCTION public.rpc_equipo_crear(
    p_codigo text,
    p_nombre text,
    p_empresa_id uuid,
    p_centro_id uuid DEFAULT NULL,
    p_operatividad public.operatividad_enum DEFAULT 'operativo',
    p_condicion public.condicion_enum DEFAULT 'bueno',
    p_rol public.equipo_rol_enum DEFAULT NULL,
    p_ubicacion public.ubicacion_enum DEFAULT 'centro',
    p_ubicacion_detalle text DEFAULT NULL
)
RETURNS public.equipos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_centro public.centros%ROWTYPE;
    v_equipo public.equipos%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    PERFORM public.assert_oficina();

    IF p_codigo IS NULL OR length(trim(p_codigo)) = 0 THEN
        RAISE EXCEPTION 'El código de equipo es obligatorio.' USING ERRCODE = 'P0001';
    END IF;

    IF p_nombre IS NULL OR length(trim(p_nombre)) = 0 THEN
        RAISE EXCEPTION 'El nombre de equipo es obligatorio.' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM public.equipos WHERE codigo = p_codigo) THEN
        RAISE EXCEPTION 'Código de equipo duplicado.' USING ERRCODE = '23505';
    END IF;

    IF p_centro_id IS NOT NULL THEN
        SELECT * INTO v_centro
        FROM public.centros
        WHERE id = p_centro_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Centro destino inexistente.' USING ERRCODE = 'P0001';
        END IF;

        IF v_centro.empresa_id <> p_empresa_id THEN
            RAISE EXCEPTION 'Centro no pertenece a la empresa especificada.' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        v_centro := NULL;
    END IF;

    INSERT INTO public.equipos (
        empresa_id,
        zona_id,
        centro_id,
        codigo,
        nombre,
        operatividad,
        condicion,
        rol,
        ubicacion,
        ubicacion_detalle,
        estado
    )
    VALUES (
        p_empresa_id,
        COALESCE(v_centro.zona_id, NULL),
        p_centro_id,
        p_codigo,
        p_nombre,
        COALESCE(p_operatividad, 'operativo'),
        COALESCE(p_condicion, 'bueno'),
        p_rol,
        COALESCE(p_ubicacion, 'centro'),
        p_ubicacion_detalle,
        'vigente'
    )
    RETURNING * INTO v_equipo;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'equipos',
        'crear',
        jsonb_build_object('equipo_id', v_equipo.id, 'codigo', v_equipo.codigo)
    );

    RETURN v_equipo;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_equipo_agregar_componente(uuid, uuid, public.component_tipo_enum);
CREATE FUNCTION public.rpc_equipo_agregar_componente(
    p_equipo_id uuid,
    p_componente_id uuid,
    p_rol_componente public.component_tipo_enum DEFAULT NULL
)
RETURNS public.equipo_componente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_equipo public.equipos%ROWTYPE;
    v_componente public.componentes%ROWTYPE;
    v_rel public.equipo_componente%ROWTYPE;
    v_rol public.component_tipo_enum;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_equipo
    FROM public.equipos
    WHERE id = p_equipo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Equipo no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_componente
    FROM public.componentes
    WHERE id = p_componente_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Componente no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_componente.empresa_id <> v_equipo.empresa_id THEN
        RAISE EXCEPTION 'Componente y equipo deben pertenecer a la misma empresa.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role IN ('admin', 'dev', 'oficina') THEN
        NULL;
    ELSIF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_equipo.centro_id IS DISTINCT FROM v_ctx.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
    END IF;

    IF v_componente.condicion = 'baja' THEN
        RAISE EXCEPTION 'Componente dado de baja: no se puede asignar.' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.equipo_componente ec
        WHERE ec.componente_id = p_componente_id
          AND ec.fecha_desasignacion IS NULL
    ) THEN
        RAISE EXCEPTION 'No se puede agregar el componente: ya está asignado a otro equipo.' USING ERRCODE = 'P0001';
    END IF;

    v_rol := COALESCE(p_rol_componente, v_componente.tipo);

    IF v_rol IN ('rov', 'controlador', 'umbilical') THEN
        IF EXISTS (
            SELECT 1
            FROM public.equipo_componente ec
            WHERE ec.equipo_id = p_equipo_id
              AND ec.rol_componente = v_rol
              AND ec.fecha_desasignacion IS NULL
        ) THEN
            IF v_rol = 'rov' THEN
                RAISE EXCEPTION 'Cambio de ROV no permitido: debe crear un nuevo equipo.' USING ERRCODE = 'P0001';
            ELSE
                RAISE EXCEPTION 'El rol de componente no permite múltiples asignaciones vigentes.' USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente, fecha_asignacion)
    VALUES (p_equipo_id, p_componente_id, v_rol, now())
    RETURNING * INTO v_rel;

    UPDATE public.componentes
    SET centro_id = v_equipo.centro_id,
        zona_id = v_equipo.zona_id,
        ubicacion = 'asignado_a_equipo',
        ubicacion_detalle = concat('Asignado a equipo ', v_equipo.codigo)
    WHERE id = p_componente_id;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'equipo_componente',
        'agregar',
        jsonb_build_object('equipo_id', p_equipo_id, 'componente_id', p_componente_id, 'rol', v_rol)
    );

    RETURN v_rel;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_equipo_quitar_componente(uuid, uuid, text);
CREATE FUNCTION public.rpc_equipo_quitar_componente(
    p_equipo_id uuid,
    p_componente_id uuid,
    p_motivo text
)
RETURNS public.equipo_componente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_equipo public.equipos%ROWTYPE;
    v_rel public.equipo_componente%ROWTYPE;
    v_ubicacion public.ubicacion_enum;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_equipo
    FROM public.equipos
    WHERE id = p_equipo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Equipo no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role IN ('admin', 'dev', 'oficina') THEN
        NULL;
    ELSIF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_equipo.centro_id IS DISTINCT FROM v_ctx.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_rel
    FROM public.equipo_componente
    WHERE equipo_id = p_equipo_id
      AND componente_id = p_componente_id
      AND fecha_desasignacion IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El componente no está asignado al equipo indicado.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.equipo_componente
    SET fecha_desasignacion = now(),
        notas = COALESCE(p_motivo, notas)
    WHERE id = v_rel.id
    RETURNING * INTO v_rel;

    v_ubicacion := COALESCE(v_equipo.ubicacion, 'centro');

    UPDATE public.componentes
    SET centro_id = v_equipo.centro_id,
        zona_id = v_equipo.zona_id,
        ubicacion = v_ubicacion,
        ubicacion_detalle = COALESCE(p_motivo, v_equipo.ubicacion_detalle)
    WHERE id = p_componente_id;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'equipo_componente',
        'quitar',
        jsonb_build_object('equipo_id', p_equipo_id, 'componente_id', p_componente_id, 'motivo', p_motivo)
    );

    RETURN v_rel;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_componente_baja_logica(uuid, text);
CREATE FUNCTION public.rpc_componente_baja_logica(
    p_componente_id uuid,
    p_motivo text
)
RETURNS public.componentes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_componente public.componentes%ROWTYPE;
    v_equipo_id uuid;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    PERFORM public.assert_oficina();

    SELECT * INTO v_componente
    FROM public.componentes
    WHERE id = p_componente_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Componente no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.componentes
    SET condicion = 'baja',
        operatividad = 'no_operativo',
        fecha_baja_logica = now(),
        motivo_baja_logica = p_motivo,
        ubicacion = 'bodega',
        ubicacion_detalle = p_motivo
    WHERE id = p_componente_id
    RETURNING * INTO v_componente;

    FOR v_equipo_id IN
        SELECT ec.equipo_id
        FROM public.equipo_componente ec
        WHERE ec.componente_id = p_componente_id
          AND ec.fecha_desasignacion IS NULL
    LOOP
        UPDATE public.equipo_componente
        SET fecha_desasignacion = now(),
            notas = COALESCE(p_motivo, notas)
        WHERE equipo_id = v_equipo_id
          AND componente_id = p_componente_id
          AND fecha_desasignacion IS NULL;

        IF v_componente.tipo = 'rov' THEN
            UPDATE public.equipos
            SET estado = 'no_vigente'
            WHERE id = v_equipo_id;
        END IF;
    END LOOP;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'componentes',
        'baja_logica',
        jsonb_build_object('componente_id', p_componente_id, 'motivo', p_motivo)
    );

    RETURN v_componente;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_prestamo_crear(uuid, uuid, uuid, text);
CREATE FUNCTION public.rpc_prestamo_crear(
    p_equipo_origen_id uuid,
    p_equipo_destino_id uuid,
    p_componente_id uuid,
    p_motivo text
)
RETURNS public.prestamos_intra
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_equipo_origen public.equipos%ROWTYPE;
    v_equipo_destino public.equipos%ROWTYPE;
    v_componente public.componentes%ROWTYPE;
    v_prestamo public.prestamos_intra%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
    END IF;

    SELECT * INTO v_equipo_origen
    FROM public.equipos
    WHERE id = p_equipo_origen_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Equipo origen no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role = 'centro' AND v_equipo_origen.centro_id IS DISTINCT FROM v_ctx.centro_id THEN
        RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
    END IF;

    IF p_equipo_destino_id IS NOT NULL THEN
        SELECT * INTO v_equipo_destino
        FROM public.equipos
        WHERE id = p_equipo_destino_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Equipo destino no encontrado.' USING ERRCODE = 'P0001';
        END IF;

        IF v_equipo_destino.centro_id IS DISTINCT FROM v_equipo_origen.centro_id THEN
            RAISE EXCEPTION 'Los equipos deben pertenecer al mismo centro.' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        v_equipo_destino := NULL;
    END IF;

    SELECT * INTO v_componente
    FROM public.componentes
    WHERE id = p_componente_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Componente no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.equipo_componente ec
        WHERE ec.equipo_id = p_equipo_origen_id
          AND ec.componente_id = p_componente_id
          AND ec.fecha_desasignacion IS NULL
    ) THEN
        RAISE EXCEPTION 'El componente no pertenece al equipo origen.' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.prestamos_intra pi
        WHERE pi.componente_id = p_componente_id
          AND pi.estado = 'activo'
    ) THEN
        RAISE EXCEPTION 'Préstamo activo: no se puede prestar nuevamente este componente.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.prestamos_intra (
        empresa_id,
        centro_id,
        equipo_origen_id,
        equipo_destino_id,
        componente_id,
        estado,
        motivo,
        responsable_id
    )
    VALUES (
        v_equipo_origen.empresa_id,
        v_equipo_origen.centro_id,
        p_equipo_origen_id,
        p_equipo_destino_id,
        p_componente_id,
        'activo',
        p_motivo,
        v_ctx.user_id
    )
    RETURNING * INTO v_prestamo;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'prestamos_intra',
        'crear',
        jsonb_build_object('prestamo_id', v_prestamo.id, 'componente_id', p_componente_id)
    );

    RETURN v_prestamo;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_prestamo_devolver(uuid, text);
CREATE FUNCTION public.rpc_prestamo_devolver(
    p_prestamo_id uuid,
    p_motivo text
)
RETURNS public.prestamos_intra
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_prestamo public.prestamos_intra%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_prestamo
    FROM public.prestamos_intra
    WHERE id = p_prestamo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Préstamo no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_prestamo.estado <> 'activo' THEN
        RAISE EXCEPTION 'Préstamo no se encuentra activo.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_ctx.centro_id IS DISTINCT FROM v_prestamo.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.prestamos_intra
    SET estado = 'devuelto',
        motivo = COALESCE(p_motivo, motivo),
        fecha_devuelto = now(),
        fecha_cierre = now()
    WHERE id = p_prestamo_id
    RETURNING * INTO v_prestamo;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'prestamos_intra',
        'devolver',
        jsonb_build_object('prestamo_id', v_prestamo.id, 'motivo', p_motivo)
    );

    RETURN v_prestamo;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_prestamo_definitivo(uuid, text);
CREATE FUNCTION public.rpc_prestamo_definitivo(
    p_prestamo_id uuid,
    p_motivo text
)
RETURNS public.prestamos_intra
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_prestamo public.prestamos_intra%ROWTYPE;
    v_componente public.componentes%ROWTYPE;
    v_equipo_destino public.equipos%ROWTYPE;
    v_equipo_origen public.equipos%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_prestamo
    FROM public.prestamos_intra
    WHERE id = p_prestamo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Préstamo no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_prestamo.estado <> 'activo' THEN
        RAISE EXCEPTION 'Préstamo no se encuentra activo.' USING ERRCODE = 'P0001';
    END IF;

    IF v_prestamo.equipo_destino_id IS NULL THEN
        RAISE EXCEPTION 'Préstamo no tiene equipo destino para consolidar.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_ctx.centro_id IS DISTINCT FROM v_prestamo.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT * INTO v_componente
    FROM public.componentes
    WHERE id = v_prestamo.componente_id
    FOR UPDATE;

    SELECT * INTO v_equipo_origen
    FROM public.equipos
    WHERE id = v_prestamo.equipo_origen_id
    FOR UPDATE;

    SELECT * INTO v_equipo_destino
    FROM public.equipos
    WHERE id = v_prestamo.equipo_destino_id
    FOR UPDATE;

    UPDATE public.equipo_componente
    SET fecha_desasignacion = now(),
        notas = COALESCE(p_motivo, notas)
    WHERE equipo_id = v_prestamo.equipo_origen_id
      AND componente_id = v_prestamo.componente_id
      AND fecha_desasignacion IS NULL;

    INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente, fecha_asignacion)
    VALUES (v_prestamo.equipo_destino_id, v_prestamo.componente_id, v_componente.tipo, now());

    UPDATE public.componentes
    SET centro_id = v_equipo_destino.centro_id,
        zona_id = v_equipo_destino.zona_id,
        ubicacion = 'asignado_a_equipo',
        ubicacion_detalle = concat('Asignado a equipo ', v_equipo_destino.codigo)
    WHERE id = v_prestamo.componente_id;

    UPDATE public.prestamos_intra
    SET estado = 'definitivo',
        motivo = COALESCE(p_motivo, motivo),
        fecha_definitivo = now(),
        fecha_cierre = now()
    WHERE id = p_prestamo_id
    RETURNING * INTO v_prestamo;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'prestamos_intra',
        'definitivo',
        jsonb_build_object('prestamo_id', v_prestamo.id, 'componente_id', v_prestamo.componente_id)
    );

    RETURN v_prestamo;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_crear(text, uuid, uuid, public.movimiento_tipo_enum, public.movimiento_localizacion_enum, text, public.movimiento_localizacion_enum, text, text);
CREATE FUNCTION public.rpc_movimiento_crear(
    p_objeto text,
    p_equipo_id uuid DEFAULT NULL,
    p_componente_id uuid DEFAULT NULL,
    p_tipo public.movimiento_tipo_enum,
    p_origen_tipo public.movimiento_localizacion_enum,
    p_origen_detalle text DEFAULT NULL,
    p_destino_tipo public.movimiento_localizacion_enum,
    p_destino_detalle text DEFAULT NULL,
    p_nota text DEFAULT NULL
)
RETURNS public.movimientos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_equipo public.equipos%ROWTYPE;
    v_componente public.componentes%ROWTYPE;
    v_mov public.movimientos%ROWTYPE;
    v_centro_origen uuid;
    v_centro_destino uuid;
    v_destino_record public.centros%ROWTYPE;
    v_empresa_id uuid;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    IF p_objeto NOT IN ('equipo', 'componente') THEN
        RAISE EXCEPTION 'Objeto inválido para movimiento.' USING ERRCODE = 'P0001';
    END IF;

    IF p_objeto = 'equipo' THEN
        IF p_equipo_id IS NULL OR p_componente_id IS NOT NULL THEN
            RAISE EXCEPTION 'Parámetros inválidos para movimiento de equipo.' USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_equipo
        FROM public.equipos
        WHERE id = p_equipo_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Equipo no encontrado.' USING ERRCODE = 'P0001';
        END IF;

        v_centro_origen := v_equipo.centro_id;
        v_empresa_id := v_equipo.empresa_id;
    ELSE
        IF p_componente_id IS NULL OR p_equipo_id IS NOT NULL THEN
            RAISE EXCEPTION 'Parámetros inválidos para movimiento de componente.' USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_componente
        FROM public.componentes
        WHERE id = p_componente_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Componente no encontrado.' USING ERRCODE = 'P0001';
        END IF;

        v_centro_origen := v_componente.centro_id;
        v_empresa_id := v_componente.empresa_id;
    END IF;

    IF p_origen_tipo = 'centro' AND p_origen_detalle IS NOT NULL THEN
        v_centro_origen := p_origen_detalle::uuid;
    END IF;

    IF p_destino_tipo = 'centro' THEN
        IF p_destino_detalle IS NULL THEN
            RAISE EXCEPTION 'Debe indicar centro destino cuando el destino es un centro.' USING ERRCODE = 'P0001';
        END IF;
        v_centro_destino := p_destino_detalle::uuid;
        SELECT * INTO v_destino_record
        FROM public.centros
        WHERE id = v_centro_destino;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Centro destino inexistente.' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        v_centro_destino := NULL;
        v_destino_record := NULL;
    END IF;

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_centro_origen IS DISTINCT FROM v_ctx.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_tipo = 'baja' OR p_destino_tipo = 'reparacion_externa' THEN
        IF p_nota IS NULL OR length(trim(p_nota)) = 0 THEN
            RAISE EXCEPTION 'Nota obligatoria para movimientos de baja o reparación externa.' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    INSERT INTO public.movimientos (
        empresa_id,
        centro_origen_id,
        centro_destino_id,
        origen_tipo,
        destino_tipo,
        tipo,
        estado,
        equipo_id,
        componente_id,
        responsable_origen_id,
        motivo,
        notas,
        origen_detalle,
        destino_detalle
    )
    VALUES (
        v_empresa_id,
        v_centro_origen,
        v_centro_destino,
        p_origen_tipo,
        p_destino_tipo,
        p_tipo,
        'pendiente',
        p_equipo_id,
        p_componente_id,
        v_ctx.user_id,
        p_tipo::text,
        p_nota,
        p_origen_detalle,
        p_destino_detalle
    )
    RETURNING * INTO v_mov;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'movimientos',
        'crear',
        jsonb_build_object('movimiento_id', v_mov.id, 'objeto', p_objeto)
    );

    RETURN v_mov;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_enviar(uuid);
CREATE FUNCTION public.rpc_movimiento_enviar(
    p_movimiento_id uuid
)
RETURNS public.movimientos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_mov public.movimientos%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_mov
    FROM public.movimientos
    WHERE id = p_movimiento_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_mov.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'Movimiento no puede enviarse: estado distinto de ''pendiente''.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_mov.centro_origen_id IS DISTINCT FROM v_ctx.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.movimientos
    SET estado = 'en_transito',
        fecha_envio = now(),
        responsable_origen_id = v_ctx.user_id
    WHERE id = p_movimiento_id
    RETURNING * INTO v_mov;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'movimientos',
        'enviar',
        jsonb_build_object('movimiento_id', v_mov.id)
    );

    RETURN v_mov;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_recibir(uuid);
CREATE FUNCTION public.rpc_movimiento_recibir(
    p_movimiento_id uuid
)
RETURNS public.movimientos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_mov public.movimientos%ROWTYPE;
    v_equipo public.equipos%ROWTYPE;
    v_componente public.componentes%ROWTYPE;
    v_destino public.centros%ROWTYPE;
    v_nueva_ubicacion public.ubicacion_enum;
    v_nuevo_centro uuid;
    v_nueva_zona uuid;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_mov
    FROM public.movimientos
    WHERE id = p_movimiento_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_mov.estado <> 'en_transito' THEN
        RAISE EXCEPTION 'Movimiento no puede recibir: estado distinto de ''en_transito''.' USING ERRCODE = 'P0001';
    END IF;

    IF v_mov.destino_tipo = 'reparacion_externa' AND v_ctx.role NOT IN ('admin', 'dev', 'oficina') THEN
        RAISE EXCEPTION 'Destino ''reparacion_externa'': sólo oficina puede recibir.' USING ERRCODE = '42501';
    END IF;

    IF v_mov.centro_destino_id IS NOT NULL THEN
        SELECT * INTO v_destino
        FROM public.centros
        WHERE id = v_mov.centro_destino_id;
    ELSE
        v_destino := NULL;
    END IF;

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_mov.centro_destino_id IS DISTINCT FROM v_ctx.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_nueva_ubicacion := CASE v_mov.destino_tipo
        WHEN 'centro' THEN 'centro'
        WHEN 'bodega' THEN 'bodega'
        WHEN 'proveedor' THEN 'proveedor'
        WHEN 'cliente' THEN 'cliente'
        WHEN 'reparacion_externa' THEN 'reparacion_externa'
        ELSE 'bodega'
    END;

    v_nuevo_centro := CASE WHEN v_mov.destino_tipo = 'centro' THEN v_mov.centro_destino_id ELSE NULL END;
    v_nueva_zona := CASE WHEN v_destino.id IS NOT NULL THEN v_destino.zona_id ELSE NULL END;

    UPDATE public.movimientos
    SET estado = 'recibido',
        fecha_recepcion = now(),
        responsable_destino_id = v_ctx.user_id
    WHERE id = p_movimiento_id
    RETURNING * INTO v_mov;

    IF v_mov.equipo_id IS NOT NULL THEN
        SELECT * INTO v_equipo
        FROM public.equipos
        WHERE id = v_mov.equipo_id
        FOR UPDATE;

        UPDATE public.equipos
        SET centro_id = v_nuevo_centro,
            zona_id = v_nueva_zona,
            ubicacion = v_nueva_ubicacion,
            ubicacion_detalle = v_mov.destino_detalle
        WHERE id = v_mov.equipo_id;

        UPDATE public.componentes c
        SET centro_id = v_nuevo_centro,
            zona_id = v_nueva_zona,
            ubicacion = 'asignado_a_equipo',
            ubicacion_detalle = v_mov.destino_detalle
        WHERE c.id IN (
            SELECT ec.componente_id
            FROM public.equipo_componente ec
            WHERE ec.equipo_id = v_mov.equipo_id
              AND ec.fecha_desasignacion IS NULL
        );

        UPDATE public.prestamos_intra
        SET estado = 'devuelto',
            fecha_devuelto = now(),
            fecha_cierre = now(),
            motivo = COALESCE(motivo, 'Autocierre por movimiento recibido')
        WHERE estado = 'activo'
          AND equipo_origen_id = v_mov.equipo_id;
    END IF;

    IF v_mov.componente_id IS NOT NULL THEN
        SELECT * INTO v_componente
        FROM public.componentes
        WHERE id = v_mov.componente_id
        FOR UPDATE;

        UPDATE public.componentes
        SET centro_id = v_nuevo_centro,
            zona_id = v_nueva_zona,
            ubicacion = v_nueva_ubicacion,
            ubicacion_detalle = v_mov.destino_detalle
        WHERE id = v_mov.componente_id;
    END IF;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'movimientos',
        'recibir',
        jsonb_build_object('movimiento_id', v_mov.id)
    );

    RETURN v_mov;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_cancelar(uuid);
CREATE FUNCTION public.rpc_movimiento_cancelar(
    p_movimiento_id uuid
)
RETURNS public.movimientos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_mov public.movimientos%ROWTYPE;
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();

    SELECT * INTO v_mov
    FROM public.movimientos
    WHERE id = p_movimiento_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_mov.estado <> 'pendiente' THEN
        RAISE EXCEPTION 'Movimiento no puede cancelarse: estado distinto de ''pendiente''.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        IF v_mov.centro_origen_id IS DISTINCT FROM v_ctx.centro_id THEN
            RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.movimientos
    SET estado = 'cancelado'
    WHERE id = p_movimiento_id
    RETURNING * INTO v_mov;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'movimientos',
        'cancelar',
        jsonb_build_object('movimiento_id', v_mov.id)
    );

    RETURN v_mov;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_bitacora_crear(jsonb, jsonb[]);
CREATE FUNCTION public.rpc_bitacora_crear(
    p_cabecera jsonb,
    p_items jsonb[]
)
RETURNS public.bitacora
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_meta, auth
AS $$
DECLARE
    v_ctx public.session_context;
    v_centro public.centros%ROWTYPE;
    v_fecha date;
    v_jornada public.bitacora_jornada_enum;
    v_estado public.bitacora_estado_puerto_enum;
    v_equipo uuid;
    v_comentarios text;
    v_motivo_atraso text;
    v_bitacora public.bitacora%ROWTYPE;
    v_item jsonb;
    v_window integer := 2; -- EDI: Ventana configurable por centro en el futuro
BEGIN
    SELECT * INTO v_ctx FROM public.v_sesion();
    PERFORM public.assert_actor_asignado();

    IF p_cabecera IS NULL THEN
        RAISE EXCEPTION 'Cabecera requerida para crear bitácora.' USING ERRCODE = 'P0001';
    END IF;

    IF (p_cabecera ->> 'centro_id') IS NOT NULL THEN
        SELECT * INTO v_centro
        FROM public.centros
        WHERE id = (p_cabecera ->> 'centro_id')::uuid;
    ELSE
        SELECT * INTO v_centro
        FROM public.centros
        WHERE id = v_ctx.centro_id;
    END IF;

    IF v_centro.id IS NULL THEN
        RAISE EXCEPTION 'Centro inválido para la bitácora.' USING ERRCODE = 'P0001';
    END IF;

    IF v_ctx.centro_id IS DISTINCT FROM v_centro.id THEN
        RAISE EXCEPTION 'Permiso denegado por política RLS.' USING ERRCODE = '42501';
    END IF;

    v_fecha := (p_cabecera ->> 'fecha')::date;
    IF v_fecha IS NULL THEN
        RAISE EXCEPTION 'Fecha inválida para bitácora.' USING ERRCODE = 'P0001';
    END IF;

    v_jornada := COALESCE((p_cabecera ->> 'jornada')::public.bitacora_jornada_enum, 'diurna');
    v_estado := COALESCE((p_cabecera ->> 'estado_puerto')::public.bitacora_estado_puerto_enum, 'abierto');
    v_equipo := NULLIF(p_cabecera ->> 'equipo_usado', '')::uuid;
    v_comentarios := NULLIF(p_cabecera ->> 'comentarios', '');
    v_motivo_atraso := NULLIF(p_cabecera ->> 'motivo_atraso', '');

    IF v_fecha < current_date - v_window THEN
        IF v_motivo_atraso IS NULL THEN
            RAISE EXCEPTION 'Registro fuera de ventana: se requiere ''motivo_atraso''.' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    INSERT INTO public.bitacora (
        empresa_id,
        zona_id,
        centro_id,
        autor_user_id,
        fecha,
        jornada,
        estado_puerto,
        equipo_usado,
        comentarios,
        motivo_atraso
    )
    VALUES (
        v_centro.empresa_id,
        v_centro.zona_id,
        v_centro.id,
        v_ctx.user_id,
        v_fecha,
        v_jornada,
        v_estado,
        v_equipo,
        v_comentarios,
        v_motivo_atraso
    )
    RETURNING * INTO v_bitacora;

    IF p_items IS NOT NULL THEN
        FOREACH v_item IN ARRAY p_items LOOP
            INSERT INTO public.bitacora_items (
                bitacora_id,
                actividad,
                descripcion,
                duracion_minutos
            )
            VALUES (
                v_bitacora.id,
                COALESCE((v_item ->> 'actividad')::public.bitacora_actividad_enum, 'operacion'),
                v_item ->> 'descripcion',
                CASE WHEN v_item ? 'duracion_minutos' THEN (v_item ->> 'duracion_minutos')::integer ELSE NULL END
            );
        END LOOP;
    END IF;

    PERFORM public.audit_event(
        v_ctx.user_id,
        v_ctx.role,
        v_ctx.centro_id,
        'bitacora',
        'crear',
        jsonb_build_object('bitacora_id', v_bitacora.id)
    );

    RETURN v_bitacora;
END;
$$;

-- ============================================================
-- 5. Smoke tests (ejecutar manualmente, mantener comentados)
-- ============================================================
-- SET LOCAL ROLE TO NONE; -- placeholder
-- -- Impersonación de contextos
-- -- SELECT set_config('request.jwt.claim.role', 'admin', true);
-- -- SELECT set_config('request.jwt.claim.centro_id', NULL, true);
-- -- SELECT set_config('request.jwt.claim.user_id', '<uuid-admin>', true);
-- -- SELECT public.rpc_guard_op('smoke_admin');
--
-- -- Verificación RLS inventario
-- -- SELECT COUNT(*) FROM public.equipos; -- admin/dev/oficina => global
-- -- SELECT COUNT(*) FROM public.equipos WHERE (public.v_sesion()).role = 'centro';
-- -- \\gset
-- -- SELECT * FROM public.equipos; -- debería devolver sólo los del centro activo
--
-- -- Validación de políticas de inserción directa (centro)
-- -- INSERT INTO public.equipos (empresa_id, codigo, nombre, ubicacion) VALUES ('<empresa>', 'EQ-TEST', 'Equipo Test', 'centro'); -- debe fallar
--
-- -- RPCs críticas
-- -- SELECT public.rpc_equipo_agregar_componente('<equipo>', '<componente-rov>', 'rov'); -- repetir debería arrojar “Cambio de ROV no permitido: debe crear un nuevo equipo.”
-- -- SELECT public.rpc_prestamo_crear('<equipo_origen>', '<equipo_destino>', '<componente_prestado>', 'Motivo prueba');
-- -- SELECT public.rpc_prestamo_crear('<equipo_origen>', '<equipo_destino>', '<componente_prestado>', 'Motivo prueba'); -- segunda vez => “Préstamo activo: no se puede prestar nuevamente este componente.”
--
-- -- Flujo movimiento
-- -- SELECT public.rpc_movimiento_crear('equipo', '<equipo>', NULL, 'traslado', 'centro', '<centro_origen>', 'centro', '<centro_destino>', 'Traslado demo');
-- -- SELECT public.rpc_movimiento_enviar('<mov_id>');
-- -- SELECT public.rpc_movimiento_recibir('<mov_id>');
-- -- Verificar que equipos y componentes heredaron ubicación y que préstamos se cerraron automáticamente.
--
-- -- Bitácora fuera de ventana
-- -- SELECT public.rpc_bitacora_crear('{"fecha":"2023-01-01","centro_id":"<centro>","jornada":"diurna"}'::jsonb, ARRAY[]::jsonb[]); -- debe fallar sin motivo
-- -- SELECT public.rpc_bitacora_crear('{"fecha":"2023-01-01","centro_id":"<centro>","jornada":"diurna","motivo_atraso":"reporte atrasado"}'::jsonb, ARRAY[]::jsonb[]);

COMMIT;
