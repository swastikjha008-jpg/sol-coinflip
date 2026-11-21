/** Wire protocol shared by the browser client and the settlement API. */

export type Network = "devnet" | "mainnet-beta";
export const NETWORKS: Network[] = ["devnet", "mainnet-beta"];
export type Side = "heads" | "tails";

export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const MEMO_PREFIX = "ffflip:v1:";
export const FEE_BPS = 300n;          // 3%
export const MULTIPLIER_BPS = 20_000n; // 2x gross

export const encodeMemo = (side: Side) => `${MEMO_PREFIX}${side}`;
export function decodeMemo(memo: string | undefined | null): Side | null {
  if (!memo || !memo.startsWith(MEMO_PREFIX)) return null;
  const s = memo.slice(MEMO_PREFIX.length).trim();
  return s === "heads" || s === "tails" ? s : null;
}

/** GET /api/config?network=... (all lamport values are decimal strings) */
export interface ConfigResponse {
  network: Network;
  enabled: boolean;
  reason?: string;
  house: string | null;
  minBet: string;
  maxBet: string;
  feeBps: number;
  multiplierBps: number;
  /** sha256(hex) of the house secret used to decide outcomes. */
  commitment: string | null;
}

/** POST /api/flip  { network, signature } */
export interface FlipRequest { network: Network; signature: string }

export interface FlipResponse {
  status: "settled" | "pending";
  signature: string;
  side?: Side;
  landed?: Side;
  won?: boolean;
  wager?: string;
  fee?: string;
  payout?: string;               // net lamports sent to the player (0 on loss)
  payoutSignature?: string | null;
  refunded?: boolean;            // true when the bet was invalid and returned
  reason?: string;
}

export interface ApiError { error: string; code: string }

export const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
