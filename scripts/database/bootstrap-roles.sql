-- Run once as a database administrator against the dedicated identity database.
-- Required environment: AUTH_DB_USER/PASS, IDENTITY_DB_USER/PASS,
-- AUDIT_DB_USER/PASS, RETENTION_DB_USER/PASS, MIGRATION_DB_USER/PASS.
-- Connect with administrator
-- credentials using psql's normal PG* environment or a password prompt.
-- The migration login must own the schemas it creates. This script never
-- grants CREATEROLE or SUPERUSER to it.
\set ON_ERROR_STOP on
\set QUIET on
\set ECHO none
\getenv auth_login AUTH_DB_USER
\getenv auth_password AUTH_DB_PASS
\getenv policy_login IDENTITY_DB_USER
\getenv policy_password IDENTITY_DB_PASS
\getenv audit_login AUDIT_DB_USER
\getenv audit_password AUDIT_DB_PASS
\getenv retention_login RETENTION_DB_USER
\getenv retention_password RETENTION_DB_PASS
\getenv migration_login MIGRATION_DB_USER
\getenv migration_password MIGRATION_DB_PASS

-- Refuse a shared login. A privileged migration login must never be used by
-- the running service, and each runtime pool must have distinct privileges.
SELECT 1 / CASE WHEN cardinality(ARRAY[
  :'auth_login', :'policy_login', :'audit_login', :'retention_login', :'migration_login'
]) = (
  SELECT count(DISTINCT login) FROM unnest(ARRAY[
    :'auth_login', :'policy_login', :'audit_login', :'retention_login', :'migration_login'
  ]) AS login
) THEN 1 ELSE 0 END;

SELECT 'CREATE ROLE identity_auth_runtime NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_auth_runtime')
\gexec
SELECT 'CREATE ROLE identity_policy_runtime NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_policy_runtime')
\gexec
SELECT 'CREATE ROLE identity_audit_runtime NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_audit_runtime')
\gexec
SELECT 'CREATE ROLE identity_audit_reader NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_audit_reader')
\gexec
SELECT 'CREATE ROLE identity_retention_maintenance NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_retention_maintenance')
\gexec

-- Existing logins and their passwords are left untouched on reruns.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'auth_login', :'auth_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'auth_login')
\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'policy_login', :'policy_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'policy_login')
\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'audit_login', :'audit_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'audit_login')
\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'retention_login', :'retention_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'retention_login')
\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'migration_login', :'migration_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_login')
\gexec

SELECT format('GRANT identity_auth_runtime TO %I', :'auth_login') \gexec
SELECT format('GRANT identity_policy_runtime TO %I', :'policy_login') \gexec
SELECT format('GRANT identity_audit_runtime TO %I', :'audit_login') \gexec
SELECT format('GRANT identity_retention_maintenance TO %I', :'retention_login') \gexec

-- The database owner, not the migration login, owns PostgreSQL's public schema.
-- Remove its implicit PUBLIC access before any service migration or runtime pool.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Give the migration login ownership of only the three service schemas.
-- Creating them here avoids granting cluster role administration or broad
-- CREATE permission on the database to the deployment migration job.
SELECT format('CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION %I', :'migration_login') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION %I', :'migration_login') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION %I', :'migration_login') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'migration_login') \gexec
SELECT format(
  'GRANT CONNECT ON DATABASE %I TO identity_auth_runtime, identity_policy_runtime, identity_audit_runtime, identity_audit_reader, identity_retention_maintenance',
  current_database()
) \gexec

-- Audit reader logins are provisioned separately by operations. They are never
-- members of a service runtime role.
