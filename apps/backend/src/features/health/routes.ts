import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ prefix: "/v1" }).get(
  "/health",
  () => ({
    ok: true,
    service: "mpckit",
    uptime: process.uptime(),
    now: new Date().toISOString(),
  }),
  {
    detail: {
      tags: ["meta"],
      summary: "Liveness probe",
      description:
        "Cheap readiness check. Returns 200 with `ok: true` and the process uptime once env is parsed and the HTTP server is listening. Reachable without auth.",
    },
  },
);
