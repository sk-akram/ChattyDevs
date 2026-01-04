export default {
  async fetch(
    _request: Request,
    _env: unknown,
    _ctx: ExecutionContext
  ): Promise<Response> {
    return new Response(
      JSON.stringify({
        status: "ok",
        service: "chattydevs-api",
        version: "v1",
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  },
};
