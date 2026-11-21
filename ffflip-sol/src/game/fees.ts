/**
 * Payout preview maths in integer lamports (no float drift).
 *
 * UNRESOLVED ECONOMICS: the brief fixes a 2x gross multiplier and a 3% platform
 * fee but not what the 3% applies to. There is no on-chain program in this
 * project to read it from, so the basis is a single switch here. The on-chain
 * program is authoritative; when one is wired in, `SettlementClient.getConfig`
 * must supply these numbers and this preview must match its calculation.
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export type FeeBasis = "wager" | "gross-payout";

export interface Economics {
  feeBps: bigint;          // 300 = 3%
  multiplierBps: bigint;   // 20000 = 2x
  feeBasis: FeeBasis;
}

export const DEFAULT_ECONOMICS: Economics = { feeBps: 300n, multiplierBps: 20_000n, feeBasis: "wager" };

export interface Preview {
  wager: bigint;
  gross: bigint;     // 2x wager
  fee: bigint;       // platform fee per flip
  netPayout: bigint; // what a winner receives after fee
  netProfit: bigint; // netPayout - wager
}

export function preview(wager: bigint, e: Economics = DEFAULT_ECONOMICS): Preview {
  const gross = (wager * e.multiplierBps) / 10_000n;
  const base = e.feeBasis === "wager" ? wager : gross;
  const fee = (base * e.feeBps) / 10_000n;
  const netPayout = gross - fee;
  return { wager, gross, fee, netPayout, netProfit: netPayout - wager };
}

/** Parses a decimal SOL string to lamports. Returns null for invalid input. */
export function solToLamports(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 9) return null;
  return BigInt(whole || "0") * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0"));
}

export function lamportsToSol(l: bigint, maxDp = 4): string {
  const neg = l < 0n; if (neg) l = -l;
  const whole = l / LAMPORTS_PER_SOL;
  let frac = (l % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, maxDp).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
