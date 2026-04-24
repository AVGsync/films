ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;

UPDATE users
SET email = lower(login || '@local.invalid')
WHERE email IS NULL OR trim(email) = '';

ALTER TABLE users ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email);
