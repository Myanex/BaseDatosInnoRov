# Despliegue solo desde GitHub (sin terminal local)

## Requisitos
- Secrets ya configurados en GitHub:
  - SUPABASE_ACCESS_TOKEN
  - SUPABASE_PROJECT_REF
  - (Opcional) SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_ROLE_KEY
- Migraciones en `supabase/migrations/`

## Flujo recomendado (2 pasos)
1) **CI de humo (automático en PR / push)**
   - Workflow: DB — Migrations & Smoke
   - Aplica migraciones en Postgres efímero y corre `tests/sql/smoke.sql`.
   - Debe estar verde antes de deploy.

2) **Deploy manual a Supabase**
   - Workflow: Deploy DB (Supabase CLI)
   - GitHub → Actions → “Deploy DB (Supabase CLI)” → Run workflow → target: dev/prod
   - Aplica `supabase/migrations/` al proyecto real.

## Si falla
- Abre el log del job → corrige migraciones o CI → nuevo PR → cuando el CI esté verde, vuelve a correr el Deploy.

## Notas
- No necesitas Git local.
- Nunca expongas keys en el repo; usa Secrets.
