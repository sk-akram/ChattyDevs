// ================== ENV ==================
type Env = {
  chattydevs_db: D1Database;
  GEMINI_API_KEY: string;
  QDRANT_URL: string;
  QDRANT_API_KEY: string;

  FASTAPI_URL: string;
  INTERNAL_SERVICE_TOKEN: string;

  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};

// ================== UTILS ==================
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
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

function normalizeDomainLikeInput(value: string): string {
  const v = value.trim();
  if (!v) return "";

  try {
    const u = v.startsWith("http://") || v.startsWith("https://") ? new URL(v) : new URL(`https://${v}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    const withoutProto = v.replace(/^https?:\/\//i, "");
    const host = withoutProto.split("/")[0].split(":")[0].toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  }
}

function parseAllowedSources(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/g)
    .map((s) => normalizeDomainLikeInput(s).trim().toLowerCase())
    .filter(Boolean);
}

function getRequestOriginHost(req: Request): string | null {
  const origin = req.headers.get("Origin") || req.headers.get("Referer");
  if (!origin) return null;
  try {
    const u = new URL(origin);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isValidEmail(email: string): boolean {
  const e = email.trim();
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const PRODUCT_AXION_ID = "prod_axion";
const PLAN_AXION_FREE_ID = "plan_axion_free";

type PlanRow = {
  id: string;
  product_id: string;
  slug: string;
  name: string;
  price_inr: number;
  message_limit_monthly: number | null;
  training_limit_lifetime: number | null;
  project_limit: number | null;
  crawl_max_pages: number | null;
  upload_mb_total: number | null;
  branding_powered_by_chattydevs: number;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  product_id: string;
  plan_id: string;
  status: string;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
};

type UsagePeriodRow = {
  id: string;
  user_id: string;
  product_id: string;
  period_start: string;
  period_end: string;
  message_count: number;
};

type UserProductStatsRow = {
  id: string;
  user_id: string;
  product_id: string;
  trainings_used: number;
  upload_bytes_used: number;
  documents_uploaded: number;
  pages_crawled: number;
  last_training_at: string | null;
};

async function ensureDefaultSubscription(env: Env, userId: string): Promise<void> {
  const existing = await env.chattydevs_db
    .prepare("SELECT id FROM subscriptions WHERE user_id = ? AND product_id = ?")
    .bind(userId, PRODUCT_AXION_ID)
    .first<{ id: string }>();

  if (!existing) {
    const startedAt = nowIso();
    const periodStart = startedAt;
    const periodEnd = addDaysIso(30);
    await env.chattydevs_db
      .prepare(
        `INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, current_period_start, current_period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        userId,
        PRODUCT_AXION_ID,
        PLAN_AXION_FREE_ID,
        "active",
        startedAt,
        periodStart,
        periodEnd
      )
      .run();
  }

  await env.chattydevs_db
    .prepare(
      `INSERT OR IGNORE INTO usage_periods (id, user_id, product_id, period_start, period_end, message_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), userId, PRODUCT_AXION_ID, nowIso(), addDaysIso(30), 0)
    .run();

  await env.chattydevs_db
    .prepare(
      `INSERT OR IGNORE INTO user_product_stats
       (id, user_id, product_id, trainings_used, upload_bytes_used, documents_uploaded, pages_crawled, last_training_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, NULL)`
    )
    .bind(crypto.randomUUID(), userId, PRODUCT_AXION_ID)
    .run();
}

async function getActiveSubscription(env: Env, userId: string, productId = PRODUCT_AXION_ID) {
  const sub = await env.chattydevs_db
    .prepare(
      "SELECT id, user_id, product_id, plan_id, status, started_at, current_period_start, current_period_end FROM subscriptions WHERE user_id = ? AND product_id = ?"
    )
    .bind(userId, productId)
    .first<SubscriptionRow>();
  return sub;
}

async function getPlanById(env: Env, planId: string) {
  return env.chattydevs_db
    .prepare(
      "SELECT id, product_id, slug, name, price_inr, message_limit_monthly, training_limit_lifetime, project_limit, crawl_max_pages, upload_mb_total, branding_powered_by_chattydevs FROM plans WHERE id = ?"
    )
    .bind(planId)
    .first<PlanRow>();
}

async function getUsagePeriod(env: Env, userId: string, productId = PRODUCT_AXION_ID) {
  return env.chattydevs_db
    .prepare(
      "SELECT id, user_id, product_id, period_start, period_end, message_count FROM usage_periods WHERE user_id = ? AND product_id = ?"
    )
    .bind(userId, productId)
    .first<UsagePeriodRow>();
}

async function rotateUsagePeriodIfNeeded(env: Env, userId: string, productId = PRODUCT_AXION_ID) {
  const usage = await getUsagePeriod(env, userId, productId);
  if (!usage) {
    await env.chattydevs_db
      .prepare(
        `INSERT INTO usage_periods (id, user_id, product_id, period_start, period_end, message_count)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), userId, productId, nowIso(), addDaysIso(30), 0)
      .run();
    return getUsagePeriod(env, userId, productId);
  }

  const now = Date.now();
  const end = Date.parse(usage.period_end);
  if (!Number.isFinite(end) || now <= end) return usage;

  const newStart = nowIso();
  const newEnd = addDaysIso(30);
  await env.chattydevs_db
    .prepare(
      "UPDATE usage_periods SET period_start = ?, period_end = ?, message_count = 0 WHERE user_id = ? AND product_id = ?"
    )
    .bind(newStart, newEnd, userId, productId)
    .run();

  await env.chattydevs_db
    .prepare(
      "UPDATE subscriptions SET current_period_start = ?, current_period_end = ? WHERE user_id = ? AND product_id = ?"
    )
    .bind(newStart, newEnd, userId, productId)
    .run();

  return getUsagePeriod(env, userId, productId);
}

async function incrementMessageUsage(env: Env, userId: string, productId = PRODUCT_AXION_ID) {
  await env.chattydevs_db
    .prepare("UPDATE usage_periods SET message_count = message_count + 1 WHERE user_id = ? AND product_id = ?")
    .bind(userId, productId)
    .run();
}

async function getUserProductStats(env: Env, userId: string, productId = PRODUCT_AXION_ID) {
  return env.chattydevs_db
    .prepare(
      "SELECT id, user_id, product_id, trainings_used, upload_bytes_used, documents_uploaded, pages_crawled, last_training_at FROM user_product_stats WHERE user_id = ? AND product_id = ?"
    )
    .bind(userId, productId)
    .first<UserProductStatsRow>();
}

async function incrementTrainingUsage(env: Env, userId: string, productId = PRODUCT_AXION_ID, updates?: { pages_crawled?: number; upload_bytes?: number; documents_uploaded?: number }) {
  const now = nowIso();
  const pages = updates?.pages_crawled ?? 0;
  const uploadBytes = updates?.upload_bytes ?? 0;
  const docs = updates?.documents_uploaded ?? 0;

  await env.chattydevs_db
    .prepare(
      `UPDATE user_product_stats
       SET trainings_used = trainings_used + 1,
           pages_crawled = pages_crawled + ?,
           upload_bytes_used = upload_bytes_used + ?,
           documents_uploaded = documents_uploaded + ?,
           last_training_at = ?
       WHERE user_id = ? AND product_id = ?`
    )
    .bind(pages, uploadBytes, docs, now, userId, productId)
    .run();
}

async function enforcePlanLimitsOrThrow(env: Env, userId: string, plan: PlanRow, action: "message" | "training" | "project_create" | "crawl" | "upload", params?: { maxPages?: number; uploadBytes?: number }) {
  const usage = await rotateUsagePeriodIfNeeded(env, userId, plan.product_id);
  const stats = await getUserProductStats(env, userId, plan.product_id);

  if (action === "message" && plan.message_limit_monthly != null) {
    if ((usage?.message_count ?? 0) >= plan.message_limit_monthly) {
      throw new Error("MESSAGE_LIMIT_EXCEEDED");
    }
  }

  if (action === "training" && plan.training_limit_lifetime != null) {
    if ((stats?.trainings_used ?? 0) >= plan.training_limit_lifetime) {
      throw new Error("TRAINING_LIMIT_EXCEEDED");
    }
  }

  if (action === "crawl" && plan.crawl_max_pages != null) {
    const requested = params?.maxPages ?? 0;
    if (requested > plan.crawl_max_pages) {
      throw new Error("CRAWL_PAGE_LIMIT_EXCEEDED");
    }
  }

  if (action === "upload" && plan.upload_mb_total != null) {
    const current = stats?.upload_bytes_used ?? 0;
    const add = params?.uploadBytes ?? 0;
    const limitBytes = plan.upload_mb_total * 1024 * 1024;
    if (current + add > limitBytes) {
      throw new Error("UPLOAD_LIMIT_EXCEEDED");
    }
  }

  if (action === "project_create" && plan.project_limit != null) {
    const projects = await env.chattydevs_db
      .prepare("SELECT COUNT(1) as cnt FROM projects WHERE user_id = ? AND product_id = ?")
      .bind(userId, plan.product_id)
      .first<{ cnt: number }>();
    if ((projects?.cnt ?? 0) >= plan.project_limit) {
      throw new Error("PROJECT_LIMIT_EXCEEDED");
    }
  }
}

async function sendEscalationEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to,
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("RESEND_ERROR", res.status, t);
  }
}

// ================== GEMINI TYPES ==================
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type GeminiEmbeddingResponse = {
  embedding: {
    values: number[];
  };
};

// ================== QDRANT TYPES ==================
type QdrantHit = {
  payload?: {
    content?: string;
    url?: string;
  };
};

type QdrantSearchResponse = {
  result: QdrantHit[];
};

// ================== GEMINI CALL ==================
async function callGeminiFlash(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "user", parts: [{ text: userMessage }] },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 900,
        },
      }),
    }
  );

  if (!res.ok) throw new Error("Gemini API failed");

  const data = (await res.json()) as GeminiResponse;

  const candidates = data.candidates ?? [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("").trim();
    if (text) return text;
  }

  return "Sorry, I couldn’t generate a response.";
}

// ================== EMBEDDING ==================
async function embedQuery(
  apiKey: string,
  text: string
): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    }
  );

  if (!res.ok) throw new Error("Embedding failed");

  const data = (await res.json()) as GeminiEmbeddingResponse;
  return data.embedding.values;
}

// ================== QDRANT SEARCH ==================
async function searchQdrant(
  env: Env,
  embedding: number[],
  projectId: string,
  limit = 5
): Promise<string[]> {
  const res = await fetch(
    `${env.QDRANT_URL}/collections/chattydevs_chunks/points/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.QDRANT_API_KEY,
      },
      body: JSON.stringify({
        vector: embedding,
        limit,
        with_payload: true,
        filter: {
          must: [
            {
              key: "project_id",
              match: { value: projectId },
            },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    console.error("QDRANT_ERROR", res.status, t);
    throw new Error("Qdrant search failed");
  }

  const data = (await res.json()) as QdrantSearchResponse;

  const results: string[] = [];

  for (const hit of data.result ?? []) {
    if (hit.payload && typeof hit.payload.content === "string") {
      results.push(hit.payload.content);
    }
  }

  return results;
}

// ================== HANDLER ==================
export default {
  async fetch(req: Request, env: Env): Promise<Response> {

    // ---------- CORS PREFLIGHT ----------
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(req.url);

    // ---------- HEALTH ----------
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "chattydevs-api" });
    }

    // ---------- CREATE USER ----------
    if (req.method === "POST" && url.pathname === "/users") {
      const body = (await req.json().catch(() => null)) as { email?: string } | null;
      if (!body?.email) return json({ error: "email is required" }, 400);

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

      await ensureDefaultSubscription(env, userId);

      return json({ user_id: userId, api_key: apiKey });
    }

    // ---------- AUTH ----------
    const apiKey = getBearerToken(req);
    if (!apiKey) return json({ error: "missing api key" }, 401);

    const user = await env.chattydevs_db
      .prepare("SELECT id FROM users WHERE api_key = ?")
      .bind(apiKey)
      .first<{ id: string }>();

    if (!user) return json({ error: "invalid api key" }, 401);

    await ensureDefaultSubscription(env, user.id);

    // ---------- ME (SUBSCRIPTION + USAGE) ----------
    if (req.method === "GET" && url.pathname === "/me") {
      const sub = await getActiveSubscription(env, user.id, PRODUCT_AXION_ID);
      const plan = sub ? await getPlanById(env, sub.plan_id) : null;
      const usage = await rotateUsagePeriodIfNeeded(env, user.id, PRODUCT_AXION_ID);
      const stats = await getUserProductStats(env, user.id, PRODUCT_AXION_ID);

      return json({
        user: { id: user.id },
        product: { id: PRODUCT_AXION_ID, slug: "axion", name: "Axion" },
        subscription: sub,
        plan,
        usage,
        stats,
      });
    }

    // ---------- CATALOG: PRODUCTS ----------
    if (req.method === "GET" && url.pathname === "/catalog/products") {
      const rows = await env.chattydevs_db
        .prepare("SELECT id, slug, name, created_at FROM products ORDER BY created_at ASC")
        .all<{ id: string; slug: string; name: string; created_at: string }>();
      return json({ products: rows.results ?? [] });
    }

    // ---------- CATALOG: PLANS ----------
    if (req.method === "GET" && url.pathname.startsWith("/catalog/products/") && url.pathname.endsWith("/plans")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const productSlug = parts[2];
      if (!productSlug) return json({ error: "invalid product" }, 400);

      const product = await env.chattydevs_db
        .prepare("SELECT id, slug, name FROM products WHERE slug = ?")
        .bind(productSlug)
        .first<{ id: string; slug: string; name: string }>();
      if (!product) return json({ error: "invalid product" }, 404);

      const plans = await env.chattydevs_db
        .prepare(
          "SELECT id, product_id, slug, name, price_inr, message_limit_monthly, training_limit_lifetime, project_limit, crawl_max_pages, upload_mb_total, branding_powered_by_chattydevs FROM plans WHERE product_id = ? ORDER BY price_inr ASC"
        )
        .bind(product.id)
        .all<PlanRow>();

      return json({ product, plans: plans.results ?? [] });
    }

    // ---------- SELECT PLAN (NO PAYMENTS YET) ----------
    if (req.method === "POST" && url.pathname === "/subscriptions/select") {
      const body = (await req.json().catch(() => null)) as {
        product_slug?: string;
        plan_slug?: string;
      } | null;

      if (!body?.product_slug || !body?.plan_slug) {
        return json({ error: "product_slug and plan_slug are required" }, 400);
      }

      if (body.plan_slug !== "free") {
        return json({ error: "upgrade coming soon" }, 400);
      }

      const product = await env.chattydevs_db
        .prepare("SELECT id FROM products WHERE slug = ?")
        .bind(body.product_slug)
        .first<{ id: string }>();
      if (!product) return json({ error: "invalid product" }, 404);

      const plan = await env.chattydevs_db
        .prepare(
          "SELECT id, product_id, slug, name, price_inr, message_limit_monthly, training_limit_lifetime, project_limit, crawl_max_pages, upload_mb_total, branding_powered_by_chattydevs FROM plans WHERE product_id = ? AND slug = ?"
        )
        .bind(product.id, body.plan_slug)
        .first<PlanRow>();
      if (!plan) return json({ error: "invalid plan" }, 404);

      const startedAt = nowIso();
      const periodStart = startedAt;
      const periodEnd = addDaysIso(30);

      const existing = await env.chattydevs_db
        .prepare("SELECT id FROM subscriptions WHERE user_id = ? AND product_id = ?")
        .bind(user.id, product.id)
        .first<{ id: string }>();

      if (existing) {
        await env.chattydevs_db
          .prepare(
            "UPDATE subscriptions SET plan_id = ?, status = 'active', current_period_start = ?, current_period_end = ? WHERE user_id = ? AND product_id = ?"
          )
          .bind(plan.id, periodStart, periodEnd, user.id, product.id)
          .run();
      } else {
        await env.chattydevs_db
          .prepare(
            `INSERT INTO subscriptions (id, user_id, product_id, plan_id, status, started_at, current_period_start, current_period_end)
             VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
          )
          .bind(crypto.randomUUID(), user.id, product.id, plan.id, startedAt, periodStart, periodEnd)
          .run();
      }

      await rotateUsagePeriodIfNeeded(env, user.id, product.id);
      return json({ ok: true });
    }

    // ---------- LIST PROJECTS ----------
    if (req.method === "GET" && url.pathname === "/projects") {
      const rows = await env.chattydevs_db
        .prepare("SELECT id, domain, created_at FROM projects WHERE user_id = ? AND product_id = ? ORDER BY created_at DESC")
        .bind(user.id, PRODUCT_AXION_ID)
        .all<{ id: string; domain: string; created_at: string }>();

      return json({ projects: rows.results ?? [] });
    }

    // ---------- GET PROJECT ----------
    if (req.method === "GET" && url.pathname.startsWith("/projects/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const projectId = parts[1];

      if (parts.length !== 2 || !projectId || projectId === "ingest" || projectId === "upload") {
        return json({ error: "Not Found" }, 404);
      }

      const project = await env.chattydevs_db
        .prepare(
          "SELECT id, domain, created_at, allowed_sources, admin_email, product_id FROM projects WHERE id = ? AND user_id = ?"
        )
        .bind(projectId, user.id)
        .first<{ id: string; domain: string; created_at: string; allowed_sources?: string | null; admin_email?: string | null; product_id?: string | null }>();

      if (!project) return json({ error: "invalid project" }, 403);
      return json({ project });
    }

    // ---------- DELETE PROJECT ----------
    if (req.method === "DELETE" && url.pathname.startsWith("/projects/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const projectId = parts[1];

      if (parts.length !== 2 || !projectId || projectId === "ingest" || projectId === "upload") {
        return json({ error: "Not Found" }, 404);
      }

      const project = await env.chattydevs_db
        .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
        .bind(projectId, user.id)
        .first<{ id: string }>();

      if (!project?.id) return json({ error: "Not Found" }, 404);

      await env.chattydevs_db
        .prepare("DELETE FROM chats WHERE project_id = ?")
        .bind(projectId)
        .run();

      await env.chattydevs_db
        .prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
        .bind(projectId, user.id)
        .run();

      fetch(`${env.FASTAPI_URL}/projects/delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: projectId }),
      }).catch((e) => {
        console.error("FASTAPI_DELETE_ERROR", e);
      });

      return json({ ok: true, project_id: projectId });
    }

    // ---------- CREATE PROJECT ----------
    if (req.method === "POST" && url.pathname === "/projects") {
      const body = (await req.json().catch(() => null)) as { name?: string; domain?: string } | null;
      const name = (body?.name ?? body?.domain ?? "").trim();
      if (!name) return json({ error: "name is required" }, 400);

      const sub = await getActiveSubscription(env, user.id, PRODUCT_AXION_ID);
      const plan = sub ? await getPlanById(env, sub.plan_id) : null;
      if (!plan) return json({ error: "missing subscription" }, 403);

      try {
        await enforcePlanLimitsOrThrow(env, user.id, plan, "project_create");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "PROJECT_LIMIT_EXCEEDED") return json({ error: "project limit exceeded" }, 402);
        return json({ error: "forbidden" }, 403);
      }

      const existing = await env.chattydevs_db
        .prepare("SELECT id FROM projects WHERE user_id = ? AND lower(domain) = lower(?) LIMIT 1")
        .bind(user.id, name)
        .first<{ id: string }>();
      if (existing?.id) return json({ error: "project name already exists" }, 409);

      const projectId = crypto.randomUUID();
      const defaultAllowedSources: string | null = null;

      await env.chattydevs_db
        .prepare(
          `INSERT INTO projects (id, user_id, domain, created_at, allowed_sources, admin_email)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          projectId,
          user.id,
          name,
          new Date().toISOString(),
          defaultAllowedSources,
          null
        )
        .run();

      await env.chattydevs_db
        .prepare("UPDATE projects SET product_id = ? WHERE id = ?")
        .bind(PRODUCT_AXION_ID, projectId)
        .run();

      return json({ project_id: projectId, domain: name, name });
    }

    // ---------- UPDATE PROJECT SETTINGS ----------
    if (req.method === "POST" && url.pathname.startsWith("/projects/") && url.pathname.endsWith("/settings")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const projectId = parts[1];
      if (!projectId) return json({ error: "invalid project" }, 400);

      const body = (await req.json().catch(() => null)) as {
        allowed_sources?: string;
        admin_email?: string;
      } | null;

      if (!body) return json({ error: "invalid payload" }, 400);

      const allowedSources = (body.allowed_sources ?? "").trim();
      const adminEmail = (body.admin_email ?? "").trim();

      if (adminEmail && !isValidEmail(adminEmail)) {
        return json({ error: "invalid admin_email" }, 400);
      }

      const project = await env.chattydevs_db
        .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
        .bind(projectId, user.id)
        .first<{ id: string }>();

      if (!project) return json({ error: "invalid project" }, 403);

      await env.chattydevs_db
        .prepare("UPDATE projects SET allowed_sources = ?, admin_email = ? WHERE id = ? AND user_id = ?")
        .bind(allowedSources, adminEmail || null, projectId, user.id)
        .run();

      return json({ ok: true });
    }

    // ---------- UPLOAD FILE (PROXY TO FASTAPI) ----------
    if (req.method === "POST" && url.pathname === "/projects/upload") {
      const form = await req.formData().catch(() => null);
      if (!form) return json({ error: "invalid form data" }, 400);

      const projectId = form.get("project_id");
      const file = form.get("file");

      if (typeof projectId !== "string" || !projectId) {
        return json({ error: "project_id is required" }, 400);
      }

      const project = await env.chattydevs_db
        .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
        .bind(projectId, user.id)
        .first();

      if (!project) return json({ error: "invalid project" }, 403);

      if (!(file instanceof File)) {
        return json({ error: "file is required" }, 400);
      }

      const sub = await getActiveSubscription(env, user.id, PRODUCT_AXION_ID);
      const plan = sub ? await getPlanById(env, sub.plan_id) : null;
      if (!plan) return json({ error: "missing subscription" }, 403);

      try {
        await enforcePlanLimitsOrThrow(env, user.id, plan, "training");
        await enforcePlanLimitsOrThrow(env, user.id, plan, "upload", { uploadBytes: file.size });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "TRAINING_LIMIT_EXCEEDED") return json({ error: "training limit exceeded" }, 402);
        if (msg === "UPLOAD_LIMIT_EXCEEDED") return json({ error: "upload limit exceeded" }, 402);
        return json({ error: "forbidden" }, 403);
      }

      const upstreamForm = new FormData();
      upstreamForm.append("project_id", projectId);
      upstreamForm.append("file", file, file.name);

      const upstream = await fetch(`${env.FASTAPI_URL}/projects/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}`,
        },
        body: upstreamForm,
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        console.error("FASTAPI_UPLOAD_ERROR", upstream.status, text);
        return json({ error: "File upload failed" }, 500);
      }

      try {
        const parsed = JSON.parse(text) as { filename?: string };
        await incrementTrainingUsage(env, user.id, PRODUCT_AXION_ID, {
          upload_bytes: file.size,
          documents_uploaded: 1,
        });
        return json(parsed);
      } catch {
        return json({ error: "Invalid upload response" }, 500);
      }
    }

    // ---------- TRIGGER INGESTION ----------
    if (req.method === "POST" && url.pathname === "/projects/ingest") {
      const body = (await req.json().catch(() => null)) as {
        project_id?: string;
        start_url?: string;
        max_pages?: number;
      } | null;

      if (!body?.project_id || !body?.start_url) {
        return json({ error: "project_id and start_url are required" }, 400);
      }

      const project = await env.chattydevs_db
        .prepare(
          "SELECT id, allowed_sources, admin_email FROM projects WHERE id = ? AND user_id = ?"
        )
        .bind(body.project_id, user.id)
        .first<{ id: string; allowed_sources?: string | null; admin_email?: string | null }>();

      if (!project) return json({ error: "invalid project" }, 403);

      const sub = await getActiveSubscription(env, user.id, PRODUCT_AXION_ID);
      const plan = sub ? await getPlanById(env, sub.plan_id) : null;
      if (!plan) return json({ error: "missing subscription" }, 403);

      try {
        await enforcePlanLimitsOrThrow(env, user.id, plan, "training");
        await enforcePlanLimitsOrThrow(env, user.id, plan, "crawl", { maxPages: body.max_pages ?? 0 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "TRAINING_LIMIT_EXCEEDED") return json({ error: "training limit exceeded" }, 402);
        if (msg === "CRAWL_PAGE_LIMIT_EXCEEDED") return json({ error: "crawl page limit exceeded" }, 402);
        return json({ error: "forbidden" }, 403);
      }

      const res = await fetch(`${env.FASTAPI_URL}/projects/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          project_id: body.project_id,
          start_url: body.start_url,
          max_pages: body.max_pages,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("FASTAPI_ERROR", text);
        return json({ error: "Ingestion failed" }, 500);
      }

      const data = await res.json();

      const pagesCrawled = typeof (data as any)?.pages_crawled === "number" ? (data as any).pages_crawled : 0;
      await incrementTrainingUsage(env, user.id, PRODUCT_AXION_ID, {
        pages_crawled: pagesCrawled,
      });
      return json(data);
    }

    // ---------- WIDGET CHAT (SOURCE-RESTRICTED) ----------
    if (req.method === "POST" && url.pathname === "/widget/chat") {
      const body = (await req.json().catch(() => null)) as {
        project_id?: string;
        message?: string;
      } | null;

      if (!body?.project_id || !body?.message) {
        return json({ error: "project_id and message are required" }, 400);
      }

      const project = await env.chattydevs_db
        .prepare(
          "SELECT id, allowed_sources, admin_email FROM projects WHERE id = ? AND user_id = ?"
        )
        .bind(body.project_id, user.id)
        .first<{ id: string; allowed_sources?: string | null; admin_email?: string | null }>();

      if (!project) return json({ error: "invalid project" }, 403);

      const sub = await getActiveSubscription(env, user.id, PRODUCT_AXION_ID);
      const plan = sub ? await getPlanById(env, sub.plan_id) : null;
      if (!plan) return json({ error: "missing subscription" }, 403);

      try {
        await enforcePlanLimitsOrThrow(env, user.id, plan, "message");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "MESSAGE_LIMIT_EXCEEDED") return json({ error: "message limit exceeded" }, 402);
        return json({ error: "forbidden" }, 403);
      }

      const allowedSources = parseAllowedSources(project.allowed_sources);
      if (allowedSources.length > 0) {
        const originHost = getRequestOriginHost(req);
        if (!originHost) return json({ error: "missing origin" }, 403);

        const ok = allowedSources.some((pattern) => originHost.includes(pattern));
        if (!ok) return json({ error: "source not allowed" }, 403);
      }

      const queryEmbedding = await embedQuery(env.GEMINI_API_KEY, body.message);
      const contexts = await searchQdrant(env, queryEmbedding, body.project_id);

      const CONTEXT_BLOCK =
        contexts.length > 0
          ? contexts.map((c, i) => `Context ${i + 1}:\n${c}`).join("\n\n")
          : "No relevant business context found.";

      const RAG_SYSTEM_PROMPT = `
You are a friendly, professional AI assistant for a business website.

Your personality:
- Warm, polite, and helpful
- Use light friendliness when appropriate (e.g., greetings, encouragement)
- You may use emojis occasionally (not excessively)
- You should feel human, not robotic

Behavior rules:
- You MUST use the provided Business Context to answer factual questions.
- If the answer is not in the Business Context, say:
  "I don’t have that information yet, but I can help with anything related to this site."
- Do NOT invent facts.
- Do NOT mention AI, models, or training data.
- Do NOT mention "context" or "database" to the user.

You are allowed to:
- Greet users naturally
- Respond empathetically
- Thank users
- Say things like "Happy to help!" or "Great question!"

Business Context:
${CONTEXT_BLOCK}
`;

      const assistantReply = await callGeminiFlash(
        env.GEMINI_API_KEY,
        RAG_SYSTEM_PROMPT,
        body.message
      );

      const needsEscalation = /don[’']?t have that information yet/i.test(assistantReply);
      const adminEmail = typeof project.admin_email === "string" ? project.admin_email.trim() : "";
      if (needsEscalation && adminEmail) {
        const originHost = getRequestOriginHost(req) || "(unknown)";
        const subject = `ChattyDevs escalation: unanswered query (project ${body.project_id})`;
        const text = `The chatbot could not answer a user query.\n\nProject ID: ${body.project_id}\nOrigin: ${originHost}\nTime: ${new Date().toISOString()}\n\nUser message:\n${body.message}\n\nBot reply:\n${assistantReply}\n`;

        sendEscalationEmail(env, adminEmail, subject, text).catch((e) => {
          console.error("ESCALATION_EMAIL_FAILED", e);
        });
      }

      await env.chattydevs_db
        .prepare(
          `INSERT INTO chats (id, project_id, user_message, assistant_message, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          body.project_id,
          body.message,
          assistantReply,
          new Date().toISOString()
        )
        .run();

      await incrementMessageUsage(env, user.id, PRODUCT_AXION_ID);

      return json({ reply: assistantReply });
    }

    // ---------- CHAT (FULL RAG) ----------
    if (req.method === "POST" && url.pathname === "/chat") {
      const body = (await req.json().catch(() => null)) as {
        project_id?: string;
        message?: string;
      } | null;

      if (!body?.project_id || !body?.message) {
        return json({ error: "project_id and message are required" }, 400);
      }

      const project = await env.chattydevs_db
        .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
        .bind(body.project_id, user.id)
        .first();

      if (!project) return json({ error: "invalid project" }, 403);

      const sub = await getActiveSubscription(env, user.id, PRODUCT_AXION_ID);
      const plan = sub ? await getPlanById(env, sub.plan_id) : null;
      if (!plan) return json({ error: "missing subscription" }, 403);

      try {
        await enforcePlanLimitsOrThrow(env, user.id, plan, "message");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "MESSAGE_LIMIT_EXCEEDED") return json({ error: "message limit exceeded" }, 402);
        return json({ error: "forbidden" }, 403);
      }

      const queryEmbedding = await embedQuery(env.GEMINI_API_KEY, body.message);
      const contexts = await searchQdrant(env, queryEmbedding, body.project_id);

      const CONTEXT_BLOCK =
        contexts.length > 0
          ? contexts.map((c, i) => `Context ${i + 1}:\n${c}`).join("\n\n")
          : "No relevant business context found.";

      const RAG_SYSTEM_PROMPT = `
You are a friendly, professional AI assistant for a business website.

Your personality:
- Warm, polite, and helpful
- Use light friendliness when appropriate (e.g., greetings, encouragement)
- You may use emojis occasionally (not excessively)
- You should feel human, not robotic

Behavior rules:
- You MUST use the provided Business Context to answer factual questions.
- If the answer is not in the Business Context, say:
  "I don’t have that information yet, but I can help with anything related to this site."
- Do NOT invent facts.
- Do NOT mention AI, models, or training data.
- Do NOT mention "context" or "database" to the user.

You are allowed to:
- Greet users naturally
- Respond empathetically
- Thank users
- Say things like "Happy to help!" or "Great question!"

Business Context:
${CONTEXT_BLOCK}
`;


      const assistantReply = await callGeminiFlash(
        env.GEMINI_API_KEY,
        RAG_SYSTEM_PROMPT,
        body.message
      );

      await env.chattydevs_db
        .prepare(
          `INSERT INTO chats (id, project_id, user_message, assistant_message, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          body.project_id,
          body.message,
          assistantReply,
          new Date().toISOString()
        )
        .run();

      await incrementMessageUsage(env, user.id, PRODUCT_AXION_ID);

      return json({ reply: assistantReply });
    }

    return json({ error: "Not Found" }, 404);
  },
};
