# Database Migrations

This directory contains SQL migration scripts for the database schema.

## How to Apply Migrations

Run any new migration scripts in numerical order against your PostgreSQL database. Make sure you
track which migrations have already been applied (for example, in a dedicated migrations table)
and only run migrations that have not yet been applied, or use a migration management tool to
handle this for you:

```bash
# Example using psql to apply a specific new migration
psql -U your_username -d your_database -f 001_create_auth_user_table.sql
```

## Migration Files

- `001_create_auth_user_table.sql` - Creates the auth_user table for JWT authentication system

## Creating New Migrations

When adding new migrations:
1. Create a new file with the next number in sequence: `00X_description.sql`
2. Add comments at the top describing what the migration does
3. Use `CREATE TABLE IF NOT EXISTS` and similar idempotent statements when possible
4. Document the migration in this README

## auth_user Table

The `auth_user` table stores authentication credentials for system users:

- `id_user` - Primary key, auto-incrementing
- `username` - Unique username for login
- `password_hash` - Scrypt hashed password (format: `salt:hash`)
- `role` - User role (default: 'admin')
- `is_active` - Boolean flag to enable/disable access
- `created_at` - Timestamp when created
- `updated_at` - Timestamp when last updated (auto-updated by trigger)

### Creating Users from NestJS (recommended)

Use the temporary/permanent endpoint `POST /api/v1/auth/register` so NestJS uses `AuthService.hashPassword()` and stores the user safely.

**Example request (Postman):**

```http
POST http://localhost:3000/api/v1/auth/register
Content-Type: application/json

{
  "username": "admin_principal",
  "password": "SuperSeguro123",
  "role": "admin"
}
```

**Response example:**

```json
{
  "idUser": 1,
  "username": "admin_principal",
  "role": "admin"
}
```

Allowed roles currently are `admin` and `user`. If no `role` is sent, `admin` is used by default.

### Creating Users manually with SQL (not recommended)

If you choose SQL directly, **first generate** `password_hash` using backend code (`AuthService.hashPassword()`), then insert:

```sql
INSERT INTO auth_user (username, password_hash, role, is_active)
VALUES ('your_username', 'salt:hash_from_backend', 'admin', true);
```

The backend AuthService will automatically fall back to environment variables (AUTH_USERNAME and AUTH_PASSWORD) if database authentication fails.
