import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { Keypair, PublicKey, SystemProgram, Transaction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, encodeMemo, decodeMemo, type Side } from "../shared/protocol.js";
import { loadEnv } from "./config.js";
import { MemoryStore, RestStore } from "./store.js";
import {
  HttpError, RESERVE, decideOutcome, economics, maxBetFor, settleFlip, getPublicConfig, type Chain, type Deps,
} from "./settle.js";
import { handleConfig, handleFlip, type Runtime } from "./handlers.js";

const SOL = 1_000_000_000n;
const house = Keypair.generate();
const player = Keypair.generate();
const secret = randomBytes(32);
const env = loadEnv({ HOUSE_SECRET_KEY: bs58.encode(house.secretKey), FLIP_SECRET: secret.toString("hex"), MAINNET_ENABLED: "true" });
const cfg = env.nets.devnet;

/** Finds a random but valid-looking signature whose decided outcome is `want`. */
function sigFor(want: Side): string {
  for (;;) {
    const s = bs58.encode(randomBytes(64));
    if (decideOutcome(secret, "devnet", s) === want) return s;
  }
}

interface MockOpts { houseBalance?: bigint; txs?: Map<string, ParsedTransactionWithMeta>; confirmAfterPolls?: number; failSend?: boolean }
function mockChain(o: MockOpts = {}) {
  const txs = o.txs ?? new Map<string, ParsedTransactionWithMeta>();
  const sent = new Map<string, { to: string; lamports: bigint }>();
  const polls = new Map<string, number>();
  let houseBalance = o.houseBalance ?? 100n * SOL;
  const chain: Chain & { sent: typeof sent; txs: typeof txs; sendCalls: number; setBalance(b: bigint): void } = {
    sent, txs, sendCalls: 0,
    setBalance(b) { houseBalance = b; },
    async getParsedTransaction(sig) { return txs.get(sig) ?? null; },
    async getBalance() { return Number(houseBalance); },
    async getLatestBlockhash() { return { blockhash: bs58.encode(randomBytes(32)), lastValidBlockHeight: 1_000 }; },
    async getBlockHeight() { return 500; },
    async sendRaw(raw) {
      chain.sendCalls++;
      if (o.failSend) throw new Error("simulation failed: insufficient funds");
      const tx = Transaction.from(raw);
      assert.ok(tx.verifySignatures(), "payout must be properly signed by the house");
      const ix = tx.instructions[0];
      const lamports = ix.data.readBigUInt64LE(4);
      const sig = bs58.encode(tx.signature!);
      sent.set(sig, { to: ix.keys[1].pubkey.toBase58(), lamports });
      return sig;
    },
    async getStatus(sig) {
      if (!sent.has(sig)) return null;
      const n = (polls.get(sig) ?? 0) + 1; polls.set(sig, n);
      return n > (o.confirmAfterPolls ?? 0) ? { confirmed: true, failed: false } : { confirmed: false, failed: false };
    },
  };
  return chain;
}

function betTx(opts: { lamports: bigint; memo?: string | null; blockTime?: number; err?: unknown; to?: PublicKey; transfers?: number; houseBefore?: bigint }): ParsedTransactionWithMeta {
  const dest = opts.to ?? house.publicKey;
  const n = opts.transfers ?? 1;
  const hb = opts.houseBefore ?? 50n * SOL;
  const ixs: unknown[] = [];
  for (let i = 0; i < n; i++) {
    ixs.push({ program: "system", programId: SystemProgram.programId, parsed: { type: "transfer", info: { source: player.publicKey.toBase58(), destination: dest.toBase58(), lamports: Number(opts.lamports) } } });
  }
  if (opts.memo !== null) ixs.push({ program: "spl-memo", programId: new PublicKey(MEMO_PROGRAM_ID), parsed: opts.memo ?? encodeMemo("heads") });
  const total = opts.lamports * BigInt(n);
  return {
    slot: 1, blockTime: opts.blockTime ?? Math.floor(Date.now() / 1000), version: "legacy",
    meta: { err: (opts.err as null) ?? null, fee: 5000, preBalances: [Number(20n * SOL), Number(hb)], postBalances: [Number(20n * SOL - total), Number(hb + total)], innerInstructions: [], logMessages: [], preTokenBalances: [], postTokenBalances: [], rewards: [] },
    transaction: {
      signatures: [], message: {
        accountKeys: [{ pubkey: player.publicKey, signer: true, writable: true, source: "transaction" }, { pubkey: dest, signer: false, writable: true, source: "transaction" }],
        instructions: ixs, recentBlockhash: "x",
      },
    },
  } as unknown as ParsedTransactionWithMeta;
}

const deps = (chain: Chain, store = new MemoryStore(), extra: Partial<Deps> = {}): Deps =>
  ({ network: "devnet", cfg, chain, store, house, secret, sleep: async () => {}, payPollMs: 0, ...extra });

/* ------------------------------------------------------------------ */

test("fee maths: 2x gross, 3% of wager", () => {
  const e = economics(1n * SOL);
  assert.equal(e.gross, 2n * SOL); assert.equal(e.fee, 30_000_000n); assert.equal(e.net, 1_970_000_000n);
});

test("memo encode/decode", () => {
  assert.equal(decodeMemo(encodeMemo("tails")), "tails");
  assert.equal(decodeMemo("ffflip:v1:sideways"), null);
  assert.equal(decodeMemo("hello"), null);
  assert.equal(decodeMemo(undefined), null);
});

test("outcome is deterministic, depends on secret + network, and is ~fair", () => {
  const s = bs58.encode(randomBytes(64));
  assert.equal(decideOutcome(secret, "devnet", s), decideOutcome(secret, "devnet", s));
  let heads = 0; const N = 4000;
  for (let i = 0; i < N; i++) if (decideOutcome(secret, "devnet", bs58.encode(randomBytes(64))) === "heads") heads++;
  assert.ok(Math.abs(heads / N - 0.5) < 0.04, `heads ratio ${heads / N}`);
});

test("maxBetFor is capped by config and by house liquidity", () => {
  assert.equal(maxBetFor(cfg, 1000n * SOL), cfg.maxBet);
  assert.equal(maxBetFor(cfg, 2n * SOL + RESERVE), SOL / 2n);
  assert.equal(maxBetFor(cfg, 1_000_000n), 0n);
});

test("WIN: pays 2x minus 3% once, to the player, signed by the house", async () => {
  const sig = sigFor("heads");
  const chain = mockChain(); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  const r = await settleFlip(deps(chain), sig);
  assert.equal(r.status, "settled"); assert.equal(r.won, true); assert.equal(r.landed, "heads");
  assert.equal(r.payout, "1970000000"); assert.equal(r.fee, "30000000");
  assert.equal(chain.sent.size, 1);
  const [p] = [...chain.sent.values()];
  assert.equal(p.to, player.publicKey.toBase58()); assert.equal(p.lamports, 1_970_000_000n);
  assert.equal(r.payoutSignature, [...chain.sent.keys()][0]);
});

test("LOSS: no payout is sent", async () => {
  const sig = sigFor("tails");
  const chain = mockChain(); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  const r = await settleFlip(deps(chain), sig);
  assert.equal(r.status, "settled"); assert.equal(r.won, false); assert.equal(r.landed, "tails"); assert.equal(r.payout, "0");
  assert.equal(chain.sendCalls, 0);
});

test("REPLAY: settling the same signature again never pays twice and returns the same result", async () => {
  const sig = sigFor("heads");
  const chain = mockChain(); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  const d = deps(chain);
  const a = await settleFlip(d, sig); const b = await settleFlip(d, sig); const c = await settleFlip(d, sig);
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.equal(chain.sent.size, 1); assert.equal(chain.sendCalls, 1);
});

test("CONCURRENT: parallel requests for one signature pay exactly once", async () => {
  const sig = sigFor("heads");
  const chain = mockChain(); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  const d = deps(chain);
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => settleFlip(d, sig)));
  assert.equal(chain.sent.size, 1);
  assert.ok(rs.every((r) => r.status === "pending" || r.won === true));
  const final = await settleFlip(d, sig);
  assert.equal(final.status, "settled"); assert.equal(chain.sent.size, 1);
});

test("player cannot influence outcome by choosing the other side", async () => {
  const sig = sigFor("heads");
  const chain = mockChain(); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("tails") }));
  const r = await settleFlip(deps(chain), sig);
  assert.equal(r.landed, "heads"); assert.equal(r.won, false);
});

test("REFUND: missing memo returns the wager and plays nothing", async () => {
  const sig = sigFor("heads");
  const chain = mockChain(); chain.txs.set(sig, betTx({ lamports: SOL, memo: null }));
  const r = await settleFlip(deps(chain), sig);
  assert.equal(r.refunded, true); assert.equal(r.won, false);
  const [p] = [...chain.sent.values()]; assert.equal(p.lamports, SOL);
});

test("REFUND: over max bet, below min bet, expired, odd layout", async () => {
  const cases: [string, Parameters<typeof betTx>[0]][] = [
    ["over max", { lamports: 6n * SOL }],
    ["below min", { lamports: 1_000_000n }],
    ["expired", { lamports: SOL, blockTime: Math.floor(Date.now() / 1000) - 3600 }],
    ["two transfers", { lamports: SOL / 2n, transfers: 2 }],
  ];
  for (const [name, o] of cases) {
    const sig = sigFor("heads");
    const chain = mockChain(); chain.txs.set(sig, betTx(o));
    const r = await settleFlip(deps(chain), sig);
    assert.equal(r.refunded, true, name);
    const [p] = [...chain.sent.values()];
    assert.equal(p.lamports, BigInt(o.lamports) * BigInt(o.transfers ?? 1), `${name}: refund amount`);
  }
});

test("REFUND: house too poor to cover payout", async () => {
  const sig = sigFor("heads");
  const chain = mockChain({ houseBalance: 1n * SOL }); chain.txs.set(sig, betTx({ lamports: 4n * SOL / 10n, houseBefore: 6n * SOL / 10n }));
  const r = await settleFlip(deps(chain), sig);
  assert.equal(r.refunded, true);
});

test("REJECT: not a bet / failed tx / bad signature / unknown tx releases claim for retry", async () => {
  const chain = mockChain();
  const s1 = sigFor("heads"); chain.txs.set(s1, betTx({ lamports: SOL, to: Keypair.generate().publicKey }));
  await assert.rejects(settleFlip(deps(chain), s1), (e: HttpError) => e.code === "not_a_bet");
  const s2 = sigFor("heads"); chain.txs.set(s2, betTx({ lamports: SOL, err: { InstructionError: [0, "x"] } }));
  await assert.rejects(settleFlip(deps(chain), s2), (e: HttpError) => e.code === "tx_failed");
  await assert.rejects(settleFlip(deps(chain), "nope"), (e: HttpError) => e.code === "bad_signature");

  const s3 = sigFor("heads"); const store = new MemoryStore(); const d = deps(chain, store);
  await assert.rejects(settleFlip(d, s3), (e: HttpError) => e.code === "tx_not_found");
  assert.equal(await store.get(`flip:devnet:${s3}`), null, "claim released so the client can retry");
  chain.txs.set(s3, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  assert.equal((await settleFlip(d, s3)).status, "settled");
  assert.equal(chain.sendCalls, 1);
});

test("PAYOUT slow to confirm: returns pending, next call finishes without a second payout", async () => {
  const sig = sigFor("heads");
  const chain = mockChain({ confirmAfterPolls: 3 }); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  let t = 0; const d = deps(chain, new MemoryStore(), { now: () => (t += 20_000), payTimeoutMs: 30_000 });
  const first = await settleFlip(d, sig);
  assert.equal(first.status, "pending");
  d.payTimeoutMs = 10_000_000; d.now = () => Date.now();
  const second = await settleFlip(d, sig);
  assert.equal(second.status, "settled"); assert.equal(second.won, true);
  assert.equal(chain.sent.size, 1, "same signed tx is re-broadcast, never a second payout");
});

test("PAYOUT send failure keeps the record so a retry cannot be abused to replay", async () => {
  const sig = sigFor("heads"); const store = new MemoryStore();
  const bad = mockChain({ failSend: true }); bad.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  await assert.rejects(settleFlip(deps(bad, store), sig), (e: HttpError) => e.code === "payout_failed");
  const rec = JSON.parse((await store.get(`flip:devnet:${sig}`))!);
  assert.equal(rec.state, "paying");
  const good = mockChain(); good.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  const r = await settleFlip(deps(good, store), sig);
  assert.equal(r.status, "settled"); assert.equal(good.sent.size, 1);
});

test("config endpoint reflects liquidity and disabled state", async () => {
  const chain = mockChain({ houseBalance: 100n * SOL });
  const c = await getPublicConfig({ network: "devnet", cfg, chain, house, secret });
  assert.equal(c.enabled, true); assert.equal(c.maxBet, cfg.maxBet.toString()); assert.equal(c.house, house.publicKey.toBase58());
  chain.setBalance(0n);
  assert.equal((await getPublicConfig({ network: "devnet", cfg, chain, house, secret })).enabled, false);
  const off = loadEnv({});
  const d = await getPublicConfig({ network: "devnet", cfg: off.nets.devnet, chain, house: null, secret: null });
  assert.equal(d.enabled, false); assert.match(d.reason!, /HOUSE_SECRET_KEY/);
  const noMain = loadEnv({ HOUSE_SECRET_KEY: bs58.encode(house.secretKey), FLIP_SECRET: secret.toString("hex") });
  assert.equal(noMain.nets["mainnet-beta"].enabled, false); assert.equal(noMain.nets.devnet.enabled, true);
});

test("HTTP handlers: validation and wiring", async () => {
  const chain = mockChain();
  const rt: Runtime = { env, store: new MemoryStore(), chainFor: () => chain };
  const get = (q: string) => handleConfig(new Request(`http://x/api/config?${q}`), rt);
  assert.equal((await get("network=bogus")).status, 400);
  const ok = await (await get("network=devnet")).json() as { enabled: boolean };
  assert.equal(ok.enabled, true);
  const post = (b: unknown, method = "POST") => handleFlip(new Request("http://x/api/flip", { method, body: method === "POST" ? (typeof b === "string" ? b : JSON.stringify(b)) : undefined }), rt);
  assert.equal((await post({}, "GET")).status, 405);
  assert.equal((await post("{not json")).status, 400);
  assert.equal((await post({ network: "devnet" })).status, 400);
  assert.equal((await post({ network: "devnet", signature: "x" })).status, 400);
  const sig = sigFor("heads"); chain.txs.set(sig, betTx({ lamports: SOL, memo: encodeMemo("heads") }));
  const r = await post({ network: "devnet", signature: sig });
  assert.equal(r.status, 200); assert.equal(((await r.json()) as { won: boolean }).won, true);
  const noStore = await handleFlip(new Request("http://x/api/flip", { method: "POST", body: JSON.stringify({ network: "devnet", signature: sig }) }), { ...rt, store: null });
  assert.equal(noStore.status, 503);
});

test("REST store speaks the Upstash protocol", async () => {
  const calls: unknown[] = [];
  const f = (async (_u: string, init: RequestInit) => { const b = JSON.parse(init.body as string); calls.push(b); return new Response(JSON.stringify({ result: b[0] === "SET" && b[3] === "NX" ? "OK" : b[0] === "GET" ? "v" : 1 })); }) as typeof fetch;
  const s = new RestStore("https://kv", "tok", f);
  assert.equal(await s.setNX("k", "v"), true); assert.equal(await s.get("k"), "v"); await s.del("k");
  assert.deepEqual(calls[0], ["SET", "k", "v", "NX"]);
});
