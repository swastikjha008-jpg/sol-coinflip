/** Local API server mirroring the Vercel functions. `pnpm dev:api` (proxied by Vite). */
import { createServer } from "node:http";
import { handleConfig, handleFlip } from "./handlers.js";

try { process.loadEnvFile(".env"); } catch { /* no .env file */ }
process.env.ALLOW_MEMORY_STORE = "true";
const port = Number(process.env.API_PORT || 8787);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks) });
  const r = url.pathname === "/api/config" ? await handleConfig(request)
    : url.pathname === "/api/flip" ? await handleFlip(request)
    : new Response("not found", { status: 404 });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`api on http://localhost:${port}`));