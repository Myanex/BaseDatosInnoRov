# CI de Base de Datos — Migrations & Smoke

## Qué hace
- Levanta Postgres efímero.
- Aplica todas las migraciones en `supabase/migrations/` en orden.
- Ejecuta `tests/sql/smoke.sql` (asserts de estructura, vistas, RLS y guard de asignación).

## Errores típicos
- **Faltan tablas/vistas núcleo**: revisar migraciones de estructura (Prompts 2–3).
- **RLS fallo** (centro leyó `profile_private`): revisar policies; identidad unificada exige RLS por `role`+`centro_id`.
- **Guard de asignación no lanzó**: revisar `assert_actor_asignado()`.

## Imagen de la DB
- Por defecto usamos `supabase/postgres:15.1.0` porque las migraciones consultan `auth.jwt()` y extensiones propias.
- Si necesitas otra versión, ajusta la imagen del servicio en `.github/workflows/db-ci.yml` (mantén compatibilidad con claims).

## Seed
- El smoke incluye el bloque de seed entre `-- CI_SEED_CHECK_START/END` y permanece comentado por defecto (pasa sin datos).
- Cuando sumes el Prompt 4 a migraciones, descomenta ese bloque para validar el seed mínimo durante el CI.

## Siguiente
- Extender smoke con RPCs (crear/enviar/recibir movimiento) y validar autocierre de préstamos al **recibir**.
