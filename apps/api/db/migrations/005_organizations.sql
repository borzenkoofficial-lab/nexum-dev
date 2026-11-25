CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS organization_members_org_role_idx ON organization_members(organization_id, role);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organization_invitations_org_email_idx ON organization_invitations(organization_id, lower(email));

CREATE OR REPLACE FUNCTION nexum_create_personal_organization() RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO organizations (name, slug)
  VALUES (COALESCE(NULLIF(trim(NEW.name), ''), 'Personal workspace'), 'personal-' || replace(NEW.id::text, '-', ''))
  RETURNING id INTO new_org_id;
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_create_personal_organization ON users;
CREATE TRIGGER users_create_personal_organization
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION nexum_create_personal_organization();

-- Backfill existing accounts without changing their existing user records.
INSERT INTO organizations (name, slug)
SELECT COALESCE(NULLIF(trim(u.name), ''), 'Personal workspace'),
       'personal-' || replace(u.id::text, '-', '')
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members m WHERE m.user_id = u.id
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM users u
JOIN organizations o ON o.slug = 'personal-' || replace(u.id::text, '-', '')
ON CONFLICT (organization_id, user_id) DO NOTHING;
