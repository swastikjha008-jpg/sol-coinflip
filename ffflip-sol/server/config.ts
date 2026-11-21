import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type { Network } from "../shared/protocol.js";

export interface NetCfg {
  network: Network;
  rpc: string;
  enabled: boolean;
  reason?: string;
  minBet: bigint;
  maxBet: bigint;
}

export interface ServerEnv {
  house: Keypair | null;
  secret: Buffer | null;
  nets: Record<Network, NetCfg>;
  problems: string[];
}

const sol = (v: string | undefined, d: string): bigint => {
  const s = (v ?? d).trim();
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 1_000_000_000n + BigInt(f.padEnd(9, "0").slice(0, 9));
};

export function parseKeypair(raw: string): Keypair {
  const t = raw.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
  return Keypair.fromSecretKey(bs58.decode(t));
}

export function loadEnv(e: Record<string, string | undefined> = process.env): ServerEnv {
  const problems: string[] = [];
  let house: Keypair | null = null;
  try { if (e.HOUSE_SECRET_KEY) house = parseKeypair(e.HOUSE_SECRET_KEY); else problems.push("HOUSE_SECRET_KEY is not set"); }
  catch { problems.push("HOUSE_SECRET_KEY is invalid (base58 or JSON byte array expected)"); }

  let secret: Buffer | null = null;
  if (!e.FLIP_SECRET) problems.push("FLIP_SECRET is not set");
  else if (!/^[0-9a-fA-F]{64,}$/.test(e.FLIP_SECRET)) problems.push("FLIP_SECRET must be >=32 bytes of hex");
  else secret = Buffer.from(e.FLIP_SECRET, "hex");

  const base = problems.length ? problems.join("; ") : undefined;
  const mainOn = e.MAINNET_ENABLED === "true";
  const nets: Record<Network, NetCfg> = {
    devnet: {
      network: "devnet",
      rpc: e.RPC_DEVNET || "https://api.devnet.solana.com",
      enabled: !base, reason: base,
      minBet: sol(e.MIN_BET_SOL_DEVNET, "0.01"), maxBet: sol(e.MAX_BET_SOL_DEVNET, "5"),
    },
    "mainnet-beta": {
      network: "mainnet-beta",
      rpc: e.RPC_MAINNET || "https://api.mainnet-beta.solana.com",
      enabled: !base && mainOn,
      reason: base ?? (mainOn ? undefined : "Mainnet is not enabled on this deployment."),
      minBet: sol(e.MIN_BET_SOL_MAINNET, "0.01"), maxBet: sol(e.MAX_BET_SOL_MAINNET, "1"),
    },
  };
  return { house, secret, nets, problems };
}
