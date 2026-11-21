import { SystemProgram, Transaction, TransactionInstruction, PublicKey } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, encodeMemo, type ApiError, type ConfigResponse, type FlipResponse } from "../../shared/protocol.js";
import { preview } from "./fees.js";
import { SettlementError, type FlipOutcome, type HouseConfig, type Network, type SettlementClient } from "./settlement.js";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T & Partial<ApiError> }> {
  const r = await fetch(`${API}${path}`, init);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

/** Real client: player transfers SOL + a memo to the house; the API verifies it on-chain, decides and pays. */
export function houseClient(network: Network): SettlementClient {
  let last: HouseConfig | null = null;
  const getConfig = async (): Promise<HouseConfig> => {
    try {
      const { status, body } = await api<ConfigResponse>(`/api/config?network=${network}`);
      if (status !== 200 || !("enabled" in body)) throw new Error("bad");
      last = { enabled: body.enabled!, reason: body.reason, house: body.house ?? null, minBet: BigInt(body.minBet!), maxBet: BigInt(body.maxBet!), commitment: body.commitment ?? null };
    } catch {
      last = { enabled: false, reason: "Settlement API is unreachable.", house: null, minBet: 0n, maxBet: 0n, commitment: null };
    }
    return last;
  };

  return {
    simulated: false,
    getConfig,
    async placeBet({ wallet, side, lamports, onPhase }) {
      const cfg = last?.house ? last : await getConfig();
      if (!cfg.enabled || !cfg.house) throw new SettlementError("disabled", cfg.reason ?? "Betting is unavailable.");

      onPhase("signing");
      const { connection, publicKey } = wallet;
      const bh = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(cfg.house), lamports }),
        new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(encodeMemo(side)) }),
      );
      const signature = await wallet.signAndSend(tx);

      onPhase("confirming");
      const conf = await connection.confirmTransaction({ signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
      if (conf.value.err) throw new SettlementError("tx_failed", "Your transaction failed on-chain. No bet was placed.", signature);

      onPhase("settling");
      let transient = 0;
      for (let i = 0; i < 90; i++) {
        let res;
        try {
          res = await api<FlipResponse>("/api/flip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ network, signature }) });
        } catch { if (++transient > 8) break; await sleep(1500); continue; }
        const { status, body } = res;
        if (status === 200 && body.status === "settled") return toOutcome(body, signature, lamports);
        const retry = status === 202 || status === 409 || status === 502 || (status === 404 && body.code === "tx_not_found") || (status === 503 && body.code !== "disabled");
        if (retry) { await sleep(1500); continue; }
        throw new SettlementError(body.code ?? "error", `${body.error ?? "Settlement failed."} Your bet transaction: ${signature}`, signature);
      }
      throw new SettlementError("timeout", `Still settling. Your bet is safe: check the explorer for ${signature} and refresh in a minute.`, signature);
    },
  };
}

function toOutcome(b: FlipResponse, signature: string, wager: bigint): FlipOutcome {
  return {
    won: !!b.won, landed: b.landed ?? null, signature, wager,
    payout: BigInt(b.payout ?? "0"), fee: BigInt(b.fee ?? "0"),
    payoutSignature: b.payoutSignature ?? null, refunded: !!b.refunded, reason: b.reason,
  };
}

/** UI preview ONLY (VITE_DEMO_MODE=true): no funds, no transactions, Math.random(). */
const demo: SettlementClient = {
  simulated: true,
  async getConfig() { return { enabled: true, house: null, minBet: 10_000_000n, maxBet: 5_000_000_000n, commitment: null }; },
  async placeBet({ lamports, side, onPhase }) {
    onPhase("signing"); await sleep(600); onPhase("confirming"); await sleep(900); onPhase("settling"); await sleep(700);
    const landed = Math.random() < 0.5 ? "heads" : "tails"; // DEMO ONLY
    const won = landed === side; const p = preview(lamports);
    return { won, landed, signature: "DEMO", wager: lamports, payout: won ? p.netPayout : 0n, fee: p.fee, payoutSignature: null, refunded: false };
  },
};

export function createSettlementClient(network: Network): SettlementClient {
  return DEMO_MODE ? demo : houseClient(network);
}
