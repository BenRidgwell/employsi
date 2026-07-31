-- Better Auth core schema, for the employsi-jobs-archive D1 database.
--
-- Generated FROM better-auth's own getAuthTables() for the installed version
-- rather than transcribed from the docs, so the columns cannot drift from what
-- the adapter expects. Regenerate the same way after a major upgrade.
--
-- Applied with:
--   wrangler d1 execute employsi-jobs-archive --remote --file migrations/0001_auth.sql
--
-- Sits alongside the app's own tables (jobs, views, feedback, feedback_votes)
-- in the one database, which is what lets a feedback post join to its author.

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id")
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_session_userId"  ON "session"("userId");
CREATE INDEX IF NOT EXISTS "idx_session_token"   ON "session"("token");
CREATE INDEX IF NOT EXISTS "idx_account_userId"  ON "account"("userId");
CREATE INDEX IF NOT EXISTS "idx_verification_id" ON "verification"("identifier");

-- Followed companies and skills, moved off localStorage now that there is a
-- real user to hang them on. The board's posts stay keyed on email (see
-- lib/feedbackFn.ts), which is what lets a post made before signing in be
-- claimed by the account that later verifies that address.
CREATE TABLE IF NOT EXISTS "user_follow" (
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "kind"    TEXT NOT NULL,          -- 'company' | 'skill'
  "ref"     TEXT NOT NULL,          -- company id, or canonical skill name
  "created" TEXT NOT NULL,
  PRIMARY KEY ("user_id", "kind", "ref")
);
