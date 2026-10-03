-- Passkeys (Face ID / Touch ID sign-in). id is the credential id (base64url);
-- public_key is the COSE public key (base64url). The private key never leaves the device.
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_passkeys_user_id ON passkeys(user_id);

-- One row per sign-in or registration ceremony in progress: single-use, five minutes.
-- user_id is set for registration (bound to who asked) and NULL for sign-in.
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id INTEGER,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
