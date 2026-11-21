import { test } from "node:test";
import assert from "node:assert/strict";
import { preview, solToLamports, lamportsToSol, DEFAULT_ECONOMICS } from "./fees.js";

test("preview: 3% of wager, 2x gross", () => {
  const p = preview(solToLamports("1")!);
  assert.equal(p.gross, 2_000_000_000n); assert.equal(p.fee, 30_000_000n);
  assert.equal(p.netPayout, 1_970_000_000n); assert.equal(p.netProfit, 970_000_000n);
});
test("preview: gross-payout basis is available but not default", () => {
  assert.equal(DEFAULT_ECONOMICS.feeBasis, "wager");
  assert.equal(preview(1_000_000_000n, { ...DEFAULT_ECONOMICS, feeBasis: "gross-payout" }).fee, 60_000_000n);
});
test("sol parsing", () => {
  assert.equal(solToLamports("0.25"), 250_000_000n);
  assert.equal(solToLamports("0.1234567891"), null);
  assert.equal(solToLamports("abc"), null); assert.equal(solToLamports(""), null); assert.equal(solToLamports("."), null);
  assert.equal(lamportsToSol(1_970_000_000n), "1.97"); assert.equal(lamportsToSol(1n), "0");
});
