-- Access-token revocation: tokens carry the admin's token_version; bumping it (password
-- change / reset) invalidates every outstanding access token immediately.
ALTER TABLE "admins" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
