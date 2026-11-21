import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import type { Network, Side } from "../../shared/protocol.js";
export type { Network, Side };

export interface HouseConfig {
  enabled: boolean;
  reason?: string;
  house: string | null;
  minBet: bigint;
  maxBet: bigint;
  commitment: string | null;
}

export interface WalletCtx {
  publicKey: PublicKey;
  connection: Connection;
  /** Sends via the connected wallet; resolves to the signature. */
  signAndSend: (tx: Transaction) => Promise<string>;
}

export type Phase = "signing" | "confirming" | "settling";

export interface FlipOutcome {
  won: boolean;
  landed: Side | null;
  signature: string;
  /** Net lamports received by the player (0 on loss / refund). */
  payout: bigint;
  fee: bigint;
  wager: bigint;
  payoutSignature: string | null;
  refunded: boolean;
  reason?: string;
}

export interface SettlementClient {
  readonly simulated: boolean;
  getConfig(): Promise<HouseConfig>;
  placeBet(a: { wallet: WalletCtx; side: Side; lamports: bigint; onPhase: (p: Phase) => void }): Promise<FlipOutcome>;
}

export class SettlementError extends Error {
  constructor(public code: string, message: string, public signature?: string) { super(message); }
}

/** Maps raw wallet / RPC errors to messages a player can act on. */
export function friendlyError(e: unknown): string {
  if (e instanceof SettlementError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|declined|cancel|User rejected/i.test(msg)) return "You declined the signature request. No SOL was spent.";
  if (/insufficient|0x1\b|debit an account/i.test(msg)) return "Not enough SOL to cover the wager and network fees.";
  if (/blockhash|expired|timeout|timed out/i.test(msg)) return "The transaction expired before it confirmed. Check your wallet history before retrying.";
  if (/fetch|network|failed to|ECONN|429|503|403/i.test(msg)) return "Network problem reaching Solana. Check your connection and try again.";
  return "Something went wrong submitting the flip. Check your wallet before retrying.";
}
