export default {
  async fetch(_req: Request, env: { chattydevs_db: D1Database }) {
    const result = await env.chattydevs_db
      .prepare("SELECT name FROM sqlite_master WHERE type='table';")
      .all();

    return new Response(
      JSON.stringify(
        {
          status: "ok",
          tables: result.results,
        },
        null,
        2
      ),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};
