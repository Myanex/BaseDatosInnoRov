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
- Por defecto usamos `postgres:15`.
- Si usas funciones/claims como en Supabase (ej. `auth.jwt()`), cambia la imagen del servicio a `supabase/postgres:15.1.0` en `.github/workflows/db-ci.yml`.

## Seed
- El smoke asume seed mínimo. Si aún no está en migraciones:
  - (Temporal) comenta el bloque “Seed” del `smoke.sql`.
  - (Recomendado) agrega tu seed (Prompt 4) dentro de `supabase/migrations/` para que CI lo aplique antes del smoke.

## Siguiente
- Extender smoke con RPCs (crear/enviar/recibir movimiento) y validar autocierre de préstamos al **recibir**.
