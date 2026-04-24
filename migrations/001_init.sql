CREATE TABLE IF NOT EXISTS users (
	id BIGSERIAL PRIMARY KEY,
	login text NOT NULL UNIQUE,
	email text NOT NULL UNIQUE,
	password_hash text NOT NULL,
	role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorites (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kp_id integer NOT NULL,
	provider text NOT NULL DEFAULT '',
	title text NOT NULL DEFAULT '',
	original_title text NOT NULL DEFAULT '',
	year text NOT NULL DEFAULT '',
	rating text NOT NULL DEFAULT '',
	poster text NOT NULL DEFAULT '',
	type text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, kp_id)
);

CREATE INDEX IF NOT EXISTS favorites_user_updated_idx ON favorites(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS history (
	id BIGSERIAL PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kp_id integer NOT NULL,
	provider text NOT NULL DEFAULT '',
	title text NOT NULL DEFAULT '',
	original_title text NOT NULL DEFAULT '',
	year text NOT NULL DEFAULT '',
	rating text NOT NULL DEFAULT '',
	poster text NOT NULL DEFAULT '',
	type text NOT NULL DEFAULT '',
	watched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS history_user_watched_idx ON history(user_id, watched_at DESC);
CREATE INDEX IF NOT EXISTS history_kp_idx ON history(kp_id);
