import type { IncomingMessage, ServerResponse } from "node:http";

type WebHandler = (req: Request) => Promise<Response>;

/** Adapts a Web-standard (Request -> Response) handler to the classic Node (req, res) signature. */
export function toNode(handler: WebHandler) {
  return async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
    try {
      const proto = (req.headers["x-forwarded-proto"] as string) || "https";
      const url = new URL(req.url || "/", `${proto}://${req.headers.host || "localhost"}`);
      let body: string | undefined;
      if (req.method && !["GET", "HEAD"].includes(req.method)) {
        if (typeof req.body === "string") body = req.body;
        else if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) body = JSON.stringify(req.body);
        else if (Buffer.isBuffer(req.body)) body = req.body.toString("utf8");
        else {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          body = Buffer.concat(chunks).toString("utf8");
        }
      }
      const r = await handler(new Request(url, { method: req.method, headers: { "content-type": "application/json" }, body }));
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      console.error("api error", e);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Unexpected server error.", code: "internal" }));
    }
  };
}
