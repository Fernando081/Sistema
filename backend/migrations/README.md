# Database Migrations

This directory contains SQL migration scripts for the database schema.

## How to Apply Migrations

Run the migration scripts in numerical order against your PostgreSQL database:

```bash
# Example using psql
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

### Creating Users

To create a user, you need to hash the password using the `AuthService.hashPassword()` method in the backend, or use this SQL function approach:

```sql
-- Note: For production use, generate the hash using the AuthService.hashPassword() method
-- This is just an example structure
INSERT INTO auth_user (username, password_hash, role, is_active)
VALUES ('your_username', 'salt:hash_from_backend', 'admin', true);
```

The backend AuthService will automatically fall back to environment variables (AUTH_USERNAME and AUTH_PASSWORD) if database authentication fails.
