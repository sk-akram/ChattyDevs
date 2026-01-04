type Env = {
  chattydevs_db: D1Database;
};

// ---------- Utils ----------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function generateApiKey() {
  return `sk-chattydevs-${crypto.randomUUID().replace(/-/g, "")}`;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

// ---------- Handler ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Health
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "chattydevs-api" });
    }

    // Create User
    if (req.method === "POST" && url.pathname === "/users") {
      const body = (await req.json().catch(() => null)) as {
        email?: string;
      } | null;

      if (!body || typeof body.email !== "string") {
        return json({ error: "email is required" }, 400);
      }

      const userId = crypto.randomUUID();
      const apiKey = generateApiKey();
      const createdAt = new Date().toISOString();

      try {
        await env.chattydevs_db
          .prepare(
            `INSERT INTO users (id, email, api_key, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .bind(userId, body.email, apiKey, createdAt)
          .run();
      } catch {
        return json({ error: "user already exists" }, 409);
      }

      return json({ user_id: userId, api_key: apiKey });
    }

    // ---------- AUTH (for protected routes) ----------
    const apiKey = getBearerToken(req);
    if (!apiKey) {
      return json({ error: "missing api key" }, 401);
    }

    const user = await env.chattydevs_db
      .prepare("SELECT id, email FROM users WHERE api_key = ?")
      .bind(apiKey)
      .first<{ id: string; email: string }>();

    if (!user) {
      return json({ error: "invalid api key" }, 401);
    }

    // Create Project
    if (req.method === "POST" && url.pathname === "/projects") {
      const body = (await req.json().catch(() => null)) as {
        domain?: string;
      } | null;

      if (!body || typeof body.domain !== "string") {
        return json({ error: "domain is required" }, 400);
      }

      const projectId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      await env.chattydevs_db
        .prepare(
          `INSERT INTO projects (id, user_id, domain, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(projectId, user.id, body.domain, createdAt)
        .run();

      return json({
        project_id: projectId,
        domain: body.domain,
      });
    }

    return json({ error: "Not Found" }, 404);
  },
};
