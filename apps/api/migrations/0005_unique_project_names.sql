CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_domain_lower
  ON projects(user_id, lower(domain));
