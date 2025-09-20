# Despliegue de Migraciones a Supabase (paso a paso)

## Requisitos (ya configurados)
- Vercel:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
- GitHub Secrets:
  - SUPABASE_ACCESS_TOKEN
  - SUPABASE_PROJECT_REF
  - SUPABASE_DB_PASSWORD
  - SUPABASE_SERVICE_ROLE_KEY (servidor solamente; nunca en el cliente)

## Ejecutar el workflow manual
1) En GitHub → Actions → **Deploy DB (Supabase CLI)**.
2) Clic en **Run workflow** → elige **target**: `dev` o `prod`.
3) Espera a que termine:
   - Pasos: checkout → instalar CLI → login (token) → link (project ref) → `supabase db push`.
4) Verifica en Supabase Studio que:
   - Tablas, enums y funciones existan.
   - RLS activas donde corresponde.

## Notas de seguridad
- No expongas `SUPABASE_SERVICE_ROLE_KEY` fuera de workflows/API backend.
- El CI “DB — Migrations & Smoke” usa Postgres efímero y no requiere claves reales.

## Problemas comunes
- **Permisos denegados**: revisa el token y project ref.
- **Migración fallida**: abre el log del job; corrige la migración y re-ejecuta.
