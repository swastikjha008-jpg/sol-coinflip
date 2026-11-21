import { createHash, createHmac } from "node:crypto";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  type ParsedTransactionWithMeta, type Commitment,
} from "@solana/web3.js";
import {
  BASE58_SIG, FEE_BPS, MEMO_PROGRAM_ID, MULTIPLIER_BPS, decodeMemo,
  type ConfigResponse, type FlipResponse, type Network, type Side,
} from "../shared/protocol.js";
import type { NetCfg } from "./config.js";
import type { Store } from "./store.js";

/* ------------------------------ economics ------------------------------ */
/** Fee is 3% of the wager, taken on every flip. Winners receive 2x wager minus that fee. */
export function economics(wager: bigint) {
  const gross = (wager * MULTIPLIER_BPS) / 10_000n;
  const fee = (wager * FEE_BPS) / 10_000n;
  return { gross, fee, net: gross - fee };
}

/** Lamports the house keeps untouched (rent-exempt minimum + tx fees headroom). */
export const RESERVE = 5_000_000n;
export const MAX_AGE_S = 15 * 60; // bets older than this are refunded, not played

/** Max wager allowed given house liquidity *before* the incoming deposit. */
export function maxBetFor(cfg: NetCfg, houseBefore: bigint): bigint {
  const liq = houseBefore > RESERVE ? (houseBefore - RESERVE) / 4n : 0n; // keeps ≥4 max bets of cover
  return liq < cfg.maxBet ? liq : cfg.maxBet;
}

/** Outcome is HMAC(secret, network:signature). The player cannot compute it before sending. */
export function decideOutcome(secret: Buffer, network: Network, signature: string): Side {
  const h = createHmac("sha256", secret).update(`${network}:${signature}`).digest();
  return (h[0] & 1) === 0 ? "heads" : "tails";
}
export const commitmentOf = (secret: Buffer) => createHash("sha256").update(secret).digest("hex");

/* -------------------------------- chain -------------------------------- */
export interface Chain {
  getParsedTransaction(sig: string): Promise<ParsedTransactionWithMeta | null>;
  getBalance(pk: PublicKey): Promise<number>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getBlockHeight(): Promise<number>;
  sendRaw(raw: Buffer): Promise<string>;
  /** null = unknown to the cluster; otherwise whether it landed / failed. */
  getStatus(sig: string): Promise<{ confirmed: boolean; failed: boolean } | null>;
}

export function chainFromConnection(c: Connection, commitment: Commitment): Chain {
  return {
    getParsedTransaction: (sig) => c.getParsedTransaction(sig, { commitment: commitment === "finalized" ? "finalized" : "confirmed", maxSupportedTransactionVersion: 0 }),
    getBalance: (pk) => c.getBalance(pk, "confirmed"),
    getLatestBlockhash: () => c.getLatestBlockhash("confirmed"),
    getBlockHeight: () => c.getBlockHeight("confirmed"),
    sendRaw: (raw) => c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }),
    async getStatus(sig) {
      const r = await c.getSignatureStatuses([sig], { searchTransactionHistory: true });
      const s = r.value[0];
      if (!s) return null;
      if (s.err) return { confirmed: false, failed: true };
      return { confirmed: s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized", failed: false };
    },
  };
}

export interface Deps {
  network: Network;
  cfg: NetCfg;
  chain: Chain;
  store: Store;
  house: Keypair;
  secret: Buffer;
  now?: () => number;                 // ms
  sleep?: (ms: number) => Promise<void>;
  payTimeoutMs?: number;
  payPollMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/* ------------------------------- config -------------------------------- */
export async function getPublicConfig(d: Pick<Deps, "network" | "cfg" | "chain"> & { house: Keypair | null; secret: Buffer | null }): Promise<ConfigResponse> {
  const { cfg, network } = d;
  const base: ConfigResponse = {
    network, enabled: cfg.enabled, reason: cfg.reason,
    house: d.house?.publicKey.toBase58() ?? null,
    minBet: cfg.minBet.toString(), maxBet: "0",
    feeBps: Number(FEE_BPS), multiplierBps: Number(MULTIPLIER_BPS),
    commitment: d.secret ? commitmentOf(d.secret) : null,
  };
  if (!cfg.enabled || !d.house) return base;
  try {
    const bal = BigInt(await d.chain.getBalance(d.house.publicKey));
    const max = maxBetFor(cfg, bal);
    if (max < cfg.minBet) return { ...base, enabled: false, reason: "House liquidity is too low right now.", maxBet: max.toString() };
    return { ...base, maxBet: max.toString() };
  } catch {
    return { ...base, enabled: false, reason: "Could not reach the Solana RPC." };
  }
}

/* ------------------------------ records -------------------------------- */
interface Rec {
  state: "pending" | "paying" | "done";
  t: number;
  player?: string;
  side?: Side;
  landed?: Side;
  won?: boolean;
  wager?: string;
  fee?: string;
  /** lamports to send to the player (payout or refund); "0" = nothing owed */
  owed?: string;
  refunded?: boolean;
  reason?: string;
  pay?: { sig: string; raw: string; lastValid: number };
  paySig?: string | null;
}

const parse = (s: string | null): Rec | null => (s ? (JSON.parse(s) as Rec) : null);
const keyOf = (n: Network, sig: string) => `flip:${n}:${sig}`;

function toResponse(sig: string, r: Rec): FlipResponse {
  if (r.state !== "done") return { status: "pending", signature: sig, side: r.side, wager: r.wager };
  return {
    status: "settled", signature: sig, side: r.side, landed: r.landed, won: r.won,
    wager: r.wager, fee: r.fee, payout: r.refunded ? "0" : r.won ? r.owed : "0",
    payoutSignature: r.paySig ?? null, refunded: r.refunded, reason: r.reason,
  };
}

/* ------------------------------ analysis -------------------------------- */
interface Analysis {
  player: PublicKey;
  received: bigint;
  transfers: number;
  side: Side | null;
  blockTime: number | null;
}

export function analyse(tx: ParsedTransactionWithMeta, house: PublicKey): Analysis | null {
  const keys = tx.transaction.message.accountKeys;
  const hi = keys.findIndex((k) => k.pubkey.equals(house));
  if (hi < 0 || !tx.meta) return null;
  const received = BigInt(tx.meta.postBalances[hi]) - BigInt(tx.meta.preBalances[hi]);
  if (received <= 0n) return null;

  let transfers = 0; let side: Side | null = null; let source: PublicKey | null = null;
  for (const ix of tx.transaction.message.instructions) {
    if (!("parsed" in ix)) continue;
    if (ix.program === "system" && ix.parsed?.type === "transfer" && ix.parsed.info.destination === house.toBase58()) {
      transfers++; source ??= new PublicKey(ix.parsed.info.source);
    }
    if ((ix.program === "spl-memo" || ix.programId.toBase58() === MEMO_PROGRAM_ID) && typeof ix.parsed === "string") {
      side = decodeMemo(ix.parsed) ?? side;
    }
  }
  const feePayer = keys[0].pubkey;
  return { player: source ?? feePayer, received, transfers, side, blockTime: tx.blockTime ?? null };
}

/* ------------------------------- settle -------------------------------- */
export async function settleFlip(d: Deps, signature: string): Promise<FlipResponse> {
  if (!BASE58_SIG.test(signature)) throw new HttpError(400, "bad_signature", "Invalid transaction signature.");
  if (!d.cfg.enabled) throw new HttpError(503, "disabled", d.cfg.reason ?? "Network disabled.");
  const now = d.now ?? Date.now;
  const key = keyOf(d.network, signature);

  let rec = parse(await d.store.get(key));
  if (!rec) {
    const claimed = await d.store.setNX(key, JSON.stringify({ state: "pending", t: now() } satisfies Rec));
    if (claimed) return decideAndPay(d, signature, key);
    rec = parse(await d.store.get(key));
  }
  if (!rec) throw new HttpError(409, "busy", "Please retry.");

  if (rec.state === "done") return toResponse(signature, rec);
  if (rec.state === "paying") return finishPayment(d, signature, key, rec);
  // pending: another worker is deciding. If it died, take over.
  if (now() - rec.t < 45_000) return { status: "pending", signature };
  await d.store.del(key);
  if (await d.store.setNX(key, JSON.stringify({ state: "pending", t: now() } satisfies Rec))) return decideAndPay(d, signature, key);
  return { status: "pending", signature };
}

async function decideAndPay(d: Deps, signature: string, key: string): Promise<FlipResponse> {
  let rec: Rec;
  try {
    rec = await decide(d, signature);
  } catch (err) {
    // Nothing decided or paid yet: free the claim so the client can retry safely.
    try { await d.store.del(key); } catch { /* best effort */ }
    throw err;
  }
  await d.store.set(key, JSON.stringify(rec));
  if (rec.state === "done") return toResponse(signature, rec);
  return finishPayment(d, signature, key, rec);
}

async function decide(d: Deps, signature: string): Promise<Rec> {
  let tx: ParsedTransactionWithMeta | null;
  try { tx = await d.chain.getParsedTransaction(signature); }
  catch { throw new HttpError(502, "rpc", "Could not read the transaction from the RPC."); }
  if (!tx) throw new HttpError(404, "tx_not_found", "Transaction not found yet.");
  if (tx.meta?.err) throw new HttpError(400, "tx_failed", "That transaction failed on-chain.");

  const a = analyse(tx, d.house.publicKey);
  if (!a) throw new HttpError(400, "not_a_bet", "That transaction did not send SOL to the house.");

  let houseNow: bigint;
  try { houseNow = BigInt(await d.chain.getBalance(d.house.publicKey)); }
  catch { throw new HttpError(502, "rpc", "Could not read the house balance."); }
  const before = houseNow > a.received ? houseNow - a.received : 0n;
  const wager = a.received;
  const e = economics(wager);
  const now = d.now ?? Date.now;

  let reason: string | undefined;
  if (a.transfers !== 1) reason = "Unsupported transaction layout.";
  else if (!a.side) reason = "Missing or invalid side.";
  else if (wager < d.cfg.minBet) reason = "Bet below the minimum.";
  else if (wager > maxBetFor(d.cfg, before)) reason = "Bet above the current maximum.";
  else if (a.blockTime === null || now() / 1000 - a.blockTime > MAX_AGE_S) reason = "Bet expired before it was settled.";
  else if (before + wager < e.net + RESERVE) reason = "House cannot cover this payout.";

  if (reason) {
    return { state: "paying", t: now(), player: a.player.toBase58(), side: a.side ?? undefined, wager: wager.toString(), fee: "0", owed: wager.toString(), refunded: true, won: false, reason };
  }
  const landed = decideOutcome(d.secret, d.network, signature);
  const won = landed === a.side;
  return { state: won ? "paying" : "done", t: now(), player: a.player.toBase58(), side: a.side!, landed, won, wager: wager.toString(), fee: e.fee.toString(), owed: won ? e.net.toString() : "0" };
}

/** Idempotently sends (or re-confirms) the payout / refund recorded in `rec`. */
async function finishPayment(d: Deps, signature: string, key: string, rec: Rec): Promise<FlipResponse> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = (d.now ?? Date.now)() + (d.payTimeoutMs ?? 40_000);
  const pollMs = d.payPollMs ?? 1500;
  const owed = BigInt(rec.owed ?? "0");

  const finish = async (paySig: string) => {
    rec = { ...rec, state: "done", paySig, pay: undefined };
    await d.store.set(key, JSON.stringify(rec));
    return toResponse(signature, rec);
  };

  while ((d.now ?? Date.now)() < deadline) {
    if (rec.pay) {
      const st = await d.chain.getStatus(rec.pay.sig).catch(() => null);
      if (st?.confirmed) return finish(rec.pay.sig);
      const expired = st?.failed || (await d.chain.getBlockHeight().catch(() => 0)) > rec.pay.lastValid;
      if (expired) { rec = { ...rec, pay: undefined }; await d.store.set(key, JSON.stringify(rec)); }
      else { await d.chain.sendRaw(Buffer.from(rec.pay.raw, "base64")).catch(() => {}); await sleep(pollMs); continue; }
    }
    // build + persist the signed tx BEFORE broadcasting so a crash can never cause a second payout
    const { blockhash, lastValidBlockHeight } = await d.chain.getLatestBlockhash();
    const tx = new Transaction({ feePayer: d.house.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: d.house.publicKey, toPubkey: new PublicKey(rec.player!), lamports: owed }),
      new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(`ffflip:${rec.refunded ? "refund" : "payout"}:${signature.slice(0, 16)}`) }),
    );
    tx.sign(d.house);
    const paySig = bs58.encode(tx.signature!);
    rec = { ...rec, pay: { sig: paySig, raw: tx.serialize().toString("base64"), lastValid: lastValidBlockHeight } };
    await d.store.set(key, JSON.stringify(rec));
    try { await d.chain.sendRaw(Buffer.from(rec.pay!.raw, "base64")); }
    catch (e) { throw new HttpError(502, "payout_failed", e instanceof Error ? e.message : "Payout failed; it will be retried."); }
    await sleep(pollMs);
  }
  return { status: "pending", signature, side: rec.side, wager: rec.wager };
}
