import { Connection } from "@solana/web3.js";
import { NETWORKS, type ApiError, type Network } from "../shared/protocol.js";
import { loadEnv, type ServerEnv } from "./config.js";
import { storeFromEnv, type Store } from "./store.js";
import { HttpError, chainFromConnection, getPublicConfig, settleFlip, type Chain } from "./settle.js";

export interface Runtime {
  env: ServerEnv;
  store: Store | null;
  chainFor(n: Network): Chain;
}

let cached: Runtime | null = null;
export function runtime(): Runtime {
  if (cached) return cached;
  const env = loadEnv();
  const conns = new Map<Network, Chain>();
  cached = {
    env,
    store: storeFromEnv(),
    chainFor(n) {
      if (!conns.has(n)) conns.set(n, chainFromConnection(new Connection(env.nets[n].rpc, "confirmed"), n === "mainnet-beta" ? "finalized" : "confirmed"));
      return conns.get(n)!;
    },
  };
  return cached;
}
export const resetRuntime = () => { cached = null; };

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const fail = (status: number, code: string, error: string) => json({ error, code } satisfies ApiError, status);
const isNetwork = (v: unknown): v is Network => NETWORKS.includes(v as Network);

export async function handleConfig(req: Request, rt: Runtime = runtime()): Promise<Response> {
  const network = new URL(req.url).searchParams.get("network");
  if (!isNetwork(network)) return fail(400, "bad_network", "network must be devnet or mainnet-beta");
  const cfg = rt.env.nets[network];
  const out = await getPublicConfig({ network, cfg, chain: rt.chainFor(network), house: rt.env.house, secret: rt.env.secret });
  if (!rt.store && out.enabled) return json({ ...out, enabled: false, reason: "Server storage is not configured." });
  return json(out);
}

export async function handleFlip(req: Request, rt: Runtime = runtime()): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method", "POST only");
  let body: { network?: unknown; signature?: unknown };
  try { body = await req.json(); } catch { return fail(400, "bad_json", "Invalid JSON body."); }
  if (!isNetwork(body.network) || typeof body.signature !== "string") return fail(400, "bad_request", "network and signature are required.");
  const { house, secret } = rt.env;
  if (!house || !secret || !rt.store) return fail(503, "disabled", rt.env.problems.join("; ") || "Server storage is not configured.");
  try {
    const out = await settleFlip(
      { network: body.network, cfg: rt.env.nets[body.network], chain: rt.chainFor(body.network), store: rt.store, house, secret },
      body.signature,
    );
    return json(out, out.status === "pending" ? 202 : 200);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message);
    console.error("flip error", e);
    return fail(500, "internal", "Unexpected server error.");
  }
}
