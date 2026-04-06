import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { chatRouter } from "./api/chat.js";
import { dashboardRouter } from "./api/dashboard.js";

const app = new Hono();

app.use("/*", cors());
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0" }));
app.route("/api", chatRouter);
app.route("/api", dashboardRouter);

console.log(`
╔══════════════════════════════════════════╗
║     SmartRouter Pro v1.0               ║
║     透明的、会成长的 AI 智能运行时       ║
║     Port: ${config.port}                          ║
╚══════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: config.port });
