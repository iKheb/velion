# Supabase SQL Editor

1. Abre tu proyecto Supabase.
2. Ve a SQL Editor.
3. En entornos nuevos, aplica migraciones incrementales desde `supabase/migrations`.
4. Usa `supabase db push` o pipeline CI para aplicar migraciones.
5. `supabase/schema.sql` se mantiene como referencia consolidada, no como fuente principal de deploy.
5. En Authentication > Providers, habilita `Email`.
6. En Authentication > Providers > Email, desactiva `Confirm email`.
7. En Authentication > URL Configuration, agrega:
   - `http://localhost:5173`
   - Tu dominio de produccion.

# Buckets
Se crean por SQL:
- avatars
- banners
- posts
- reels
- stories
- chat
- clips

# RLS
Todas las tablas tienen RLS habilitado y politicas base para:
- lectura publica cuando aplica
- escritura solo del propietario
- moderacion admin para reportes/analytics

# Validacion de migraciones
- Ejecutar `npm run migrations:validate` en CI contra:
  - DB vacia (`MIGRATION_VALIDATE_EMPTY_DB_URL`)
  - DB existente (`MIGRATION_VALIDATE_EXISTING_DB_URL`)
- Revisar rollback por migracion en `docs/migration-rollback-plan.md`.
