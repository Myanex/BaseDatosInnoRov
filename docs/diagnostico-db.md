# Diagnóstico de base de datos

## Resumen
- Las migraciones residen en `migrations` (4 archivos SQL).
- No existe el directorio `supabase/migrations/`; la ruta única activa es `migrations/`.

## Listado de migraciones
| Archivo | Tamaño (bytes) | Primeras 40 líneas |
| --- | ---: | --- |
| `0001_identidades_unificadas.sql` | 12981 | ```sql
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
``` |
| `0002_tablas_operativas.sql` | 44659 | ```sql
-- Migración: Tablas operativas, catálogos y auditoría mínima
-- Contexto: Proyecto Sistema de Gestión ROV (Supabase)
-- EDI: Greenfield (continuación). Se valida idempotencia y bloqueos globales.

BEGIN;

-- Adquiere candado para evitar condiciones de carrera durante la migración
SELECT pg_advisory_xact_lock(hashtext('migrations:0002_tablas_operativas'));

-- ============================================================
-- 0. Extensiones y helpers reutilizables
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Actualiza role_enum con rol de desarrollo si aún no existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'role_enum'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            WHERE e.enumtypid = 'public.role_enum'::regtype
              AND e.enumlabel = 'dev'
        ) THEN
            ALTER TYPE public.role_enum ADD VALUE 'dev' BEFORE 'admin';
        END IF;
    ELSE
        CREATE TYPE public.role_enum AS ENUM ('dev', 'admin', 'oficina', 'centro');
    END IF;
END;
$$;

-- Función utilitaria para mantener updated_at coherente en tablas con historial
DROP FUNCTION IF EXISTS public.trg_set_updated_at();
``` |
| `0003_rls_rpcs.sql` | 65193 | ```sql
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
``` |
| `0004_seed_demo_determinista.sql` | 26088 | ```sql
-- Seed determinista de datos demo + suite QA (Prompt 4)
-- Contexto: Dataset base para validar RLS, RPCs y flujos operativos.

BEGIN;

-- Candado para evitar colisiones durante la semilla
SELECT pg_advisory_xact_lock(hashtext('seed:demo_dataset_v1'));

DO $$
DECLARE
    v_now timestamptz := timezone('UTC', now());
    v_empresa uuid;
    v_zona uuid;
    v_centro_c1 uuid;
    v_centro_c2 uuid;
    v_eq1 uuid;
    v_eq2 uuid;
    v_comp_rov uuid;
    v_comp_ctrl uuid;
    v_comp_umb uuid;
    v_comp_sensor uuid;
    v_comp_sensor_c2 uuid;
    v_comp_sensor_bodega uuid;
    v_prestamo uuid;
    v_movimiento uuid;
    v_bitacora_hoy uuid;
    v_bitacora_atrasada uuid;
    v_user_admin constant uuid := '11111111-1111-1111-1111-111111111111';
    v_user_oficina constant uuid := '22222222-2222-2222-2222-222222222222';
    v_user_centro_asignado constant uuid := '33333333-3333-3333-3333-333333333333';
    v_user_centro_no_asignado constant uuid := '44444444-4444-4444-4444-444444444444';
    v_instance constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- ============================================================
    -- 1. Organización: empresa → zona → centros
    -- ============================================================
    INSERT INTO public.empresas (nombre, slug, estado, is_demo)
    VALUES ('Empresa Demo E1', 'empresa-demo-e1', 'activa', true)
    ON CONFLICT (slug) DO UPDATE
        SET nombre = EXCLUDED.nombre,
``` |

## Chequeos de contenido
### `0001_identidades_unificadas.sql`
- `BEGIN` / `COMMIT`: ✅
- Candado (`pg_advisory_xact_lock`): ✅
- Tablas núcleo con `CREATE TABLE`: `profiles`.
- Tablas núcleo ausentes en este archivo: `empresas`, `zonas`, `centros`, `componentes`, `equipos`, `equipo_componente`, `prestamos_intra`, `movimientos`, `bitacora`, `bitacora_items`, `profile_private`, `pilot_situaciones`, `audit_event`.
- Función `public.v_sesion`: ✅
- Guard `public.assert_actor_asignado`: ✅

### `0002_tablas_operativas.sql`
- `BEGIN` / `COMMIT`: ✅
- Candado (`pg_advisory_xact_lock`): ✅
- Tablas núcleo con `CREATE TABLE`: `empresas`, `zonas`, `centros`, `componentes`, `equipos`, `equipo_componente`, `prestamos_intra`, `movimientos`, `bitacora`, `bitacora_items`, `profile_private`, `pilot_situaciones`, `audit_event`.
- Tablas núcleo ausentes en este archivo: `profiles`.
- Función `public.v_sesion`: ⬜ no aplica en este archivo
- Guard `public.assert_actor_asignado`: ⬜ no aplica en este archivo

### `0003_rls_rpcs.sql`
- `BEGIN` / `COMMIT`: ✅
- Candado (`pg_advisory_xact_lock`): ✅
- Tablas núcleo con `CREATE TABLE`: ninguna en este archivo.
- Tablas núcleo ausentes en este archivo: `empresas`, `zonas`, `centros`, `componentes`, `equipos`, `equipo_componente`, `prestamos_intra`, `movimientos`, `bitacora`, `bitacora_items`, `profiles`, `profile_private`, `pilot_situaciones`, `audit_event`.
- Función `public.v_sesion`: ✅
- Guard `public.assert_actor_asignado`: ✅

### `0004_seed_demo_determinista.sql`
- `BEGIN` / `COMMIT`: ✅
- Candado (`pg_advisory_xact_lock`): ✅
- Tablas núcleo con `CREATE TABLE`: ninguna en este archivo.
- Tablas núcleo ausentes en este archivo: `empresas`, `zonas`, `centros`, `componentes`, `equipos`, `equipo_componente`, `prestamos_intra`, `movimientos`, `bitacora`, `bitacora_items`, `profiles`, `profile_private`, `pilot_situaciones`, `audit_event`.
- Función `public.v_sesion`: ⬜ no aplica en este archivo
- Guard `public.assert_actor_asignado`: ⬜ no aplica en este archivo

## CI Workflow
- Workflow `db-ci.yml` aplica cada SQL encontrado en `supabase/migrations` y `migrations` (usa `find supabase/migrations migrations ...`).
- La base de datos de CI usa la imagen `postgres:15` por defecto (opción Supabase comentada).
- Debido a `set -e`, la ausencia de `supabase/migrations/` provoca que `find` retorne error y falle la ejecución antes de aplicar migraciones.

## Smoke
- El archivo `tests/sql/smoke.sql` existe con los marcadores `-- CI_SEED_CHECK_START` y `-- CI_SEED_CHECK_END`.
- El bloque Seed dentro de los marcadores está comentado, por lo que no exige datos de semilla actualmente.

## Conclusiones
- Las migraciones de estructura solicitadas en los Prompts 2/3 están presentes en `migrations/` (tablas núcleo y helpers).
- El workflow de CI intenta aplicar SQL desde `supabase/migrations/`, ruta que no existe en el repo, causando fallo inmediato.
- El smoke test no exige Seed obligatorio porque permanece comentado bajo los marcadores CI.
- Las migraciones dependen del esquema `auth` y funciones Supabase (`auth.jwt()`), por lo que se recomienda usar `supabase/postgres` en lugar de `postgres:15` para CI.

## Checklist de acciones
1. Ajustar el workflow para ignorar rutas inexistentes (o crear el directorio `supabase/migrations/`) y evitar el error de `find` bajo `set -e`.
2. Cambiar la imagen de servicio a `supabase/postgres` (o equivalente) para disponer del esquema `auth` y funciones requeridas por las migraciones.
3. Ejecutar nuevamente las migraciones y el smoke test tras los ajustes para verificar que corren exitosamente con la semilla opcional desactivada.
