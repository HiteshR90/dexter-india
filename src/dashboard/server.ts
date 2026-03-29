import { join } from "path";
import {
  handleUpload,
  handlePortfolio,
  handleAnalysis,
  handleMarket,
  handleNews,
  handleInsights,
} from "./routes";

const PORT = parseInt(process.env.DASHBOARD_PORT || "3000", 10);
const PUBLIC_DIR = join(import.meta.dir, "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function addCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120, // Allow up to 120s for large portfolio quote fetching
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // API routes
    if (path.startsWith("/api/")) {
      let res: Response;

      try {
        if (path === "/api/upload" && req.method === "POST") {
          res = await handleUpload(req);
        } else if (path === "/api/portfolio" && req.method === "GET") {
          res = await handlePortfolio();
        } else if (path === "/api/portfolio/analysis" && req.method === "GET") {
          res = await handleAnalysis();
        } else if (path === "/api/market" && req.method === "GET") {
          res = await handleMarket();
        } else if (path === "/api/news" && req.method === "GET") {
          res = await handleNews();
        } else if (path === "/api/insights" && req.method === "GET") {
          res = await handleInsights();
        } else {
          res = new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (e: any) {
        res = new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return addCors(res);
    }

    // Static files
    let filePath = join(PUBLIC_DIR, path === "/" ? "index.html" : path);

    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const ext = "." + filePath.split(".").pop();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        return new Response(file, {
          headers: { "Content-Type": contentType, ...corsHeaders() },
        });
      }
    } catch {
      // Fall through to 404
    }

    // SPA fallback
    const index = Bun.file(join(PUBLIC_DIR, "index.html"));
    if (await index.exists()) {
      return new Response(index, {
        headers: { "Content-Type": "text/html", ...corsHeaders() },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`
╔══════════════════════════════════════════════╗
║   🚀 Dexter India — Portfolio Dashboard     ║
║   Running on http://localhost:${PORT}           ║
╚══════════════════════════════════════════════╝
`);
