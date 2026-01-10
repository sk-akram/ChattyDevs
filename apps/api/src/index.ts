// ================== ENV ==================
type Env = {
  chattydevs_db: D1Database;
  GEMINI_API_KEY: string;
  QDRANT_URL: string;
  QDRANT_API_KEY: string;

  FASTAPI_URL: string;
  INTERNAL_SERVICE_TOKEN: string;
};

// ================== UTILS ==================
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
          maxOutputTokens: 300,
        },
      }),
    }
  );

  if (!res.ok) throw new Error("Gemini API failed");

  const data = (await res.json()) as GeminiResponse;

  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text ??
    "Sorry, I couldn’t generate a response."
  );
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
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    // ---------- CREATE PROJECT ----------
    if (req.method === "POST" && url.pathname === "/projects") {
      const body = (await req.json().catch(() => null)) as { domain?: string } | null;
      if (!body?.domain) return json({ error: "domain is required" }, 400);

      const projectId = crypto.randomUUID();

      await env.chattydevs_db
        .prepare(
          `INSERT INTO projects (id, user_id, domain, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(projectId, user.id, body.domain, new Date().toISOString())
        .run();

      return json({ project_id: projectId, domain: body.domain });
    }

    // ---------- TRIGGER INGESTION ----------
    if (req.method === "POST" && url.pathname === "/projects/ingest") {
      const body = (await req.json().catch(() => null)) as {
        project_id?: string;
        start_url?: string;
      } | null;

      if (!body?.project_id || !body?.start_url) {
        return json({ error: "project_id and start_url are required" }, 400);
      }

      const project = await env.chattydevs_db
        .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
        .bind(body.project_id, user.id)
        .first();

      if (!project) return json({ error: "invalid project" }, 403);

      const res = await fetch(`${env.FASTAPI_URL}/projects/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": env.INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          project_id: body.project_id,
          start_url: body.start_url,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("FASTAPI_ERROR", text);
        return json({ error: "Ingestion failed" }, 500);
      }

      const data = await res.json();
      return json(data);
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

      const queryEmbedding = await embedQuery(env.GEMINI_API_KEY, body.message);
      const contexts = await searchQdrant(env, queryEmbedding, body.project_id);

      const CONTEXT_BLOCK =
        contexts.length > 0
          ? contexts.map((c, i) => `Context ${i + 1}:\n${c}`).join("\n\n")
          : "No relevant business context found.";

      const RAG_SYSTEM_PROMPT = `
You are a professional AI assistant for a business website.

Rules:
- Answer ONLY using the provided context
- If the answer is not in the context, say: "I don’t have that information"
- Do NOT mention AI, models, or training data

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

      return json({ reply: assistantReply });
    }

    return json({ error: "Not Found" }, 404);
  },
};
