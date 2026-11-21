import { useMemo } from "react";
import { DEFAULT_ECONOMICS, lamportsToSol, preview, solToLamports } from "../game/fees";
import type { Side } from "../game/settlement";

export const QUICK = ["0.1", "0.25", "0.5", "1", "2", "3", "4", "5"];
export type UiPhase = "idle" | "signing" | "confirming" | "settling";

interface Props {
  connected: boolean;
  balance: bigint | null;
  amount: string;
  setAmount: (v: string) => void;
  side: Side | null;
  setSide: (s: Side) => void;
  minBet: bigint;
  maxBet: bigint;
  phase: UiPhase;
  enabled: boolean;
  reason?: string;
  loading: boolean;
  simulated: boolean;
  mainnet: boolean;
  onConnect: () => void;
  onFlip: () => void;
}

const PHASE_LABEL: Record<UiPhase, string> = {
  idle: "FLIP COIN",
  signing: "CONFIRM IN WALLET…",
  confirming: "CONFIRMING ON-CHAIN…",
  settling: "SETTLING FLIP…",
};

const NETWORK_FEE_BUFFER = 10_000n; // lamports

export function validate(p: { connected: boolean; amount: string; side: Side | null; balance: bigint | null; minBet: bigint; maxBet: bigint; enabled: boolean }): string | null {
  if (!p.enabled) return null;
  if (!p.connected) return "Connect a wallet to play.";
  if (!p.side) return "Choose Heads or Tails.";
  const l = solToLamports(p.amount);
  if (l === null || l <= 0n) return "Enter a valid bet amount.";
  if (l < p.minBet) return `Minimum bet is ${lamportsToSol(p.minBet, 4)} SOL.`;
  if (l > p.maxBet) return `Maximum bet is ${lamportsToSol(p.maxBet, 4)} SOL.`;
  if (p.balance !== null && l + NETWORK_FEE_BUFFER > p.balance) return "Not enough SOL for this bet plus network fees.";
  return null;
}

export function BetPanel(p: Props) {
  const busy = p.phase !== "idle";
  const lamports = solToLamports(p.amount);
  const pv = useMemo(() => (lamports && lamports > 0n ? preview(lamports, DEFAULT_ECONOMICS) : null), [lamports]);
  const problem = validate(p);
  const canFlip = p.enabled && p.connected && !problem && !busy && !p.loading;

  return (
    <section className={`panel notch ${p.mainnet ? "is-main" : ""}`} aria-label="Place your bet">
      <div className="panel-head">
        <span className="tag">[ PLACE BET ]</span>
        <span className="tag dim">{p.mainnet ? "MAINNET · REAL SOL" : "DEVNET · TEST SOL"}</span>
      </div>

      {p.simulated && <div className="banner demo">DEMO MODE — no real funds, no transactions</div>}
      {!p.enabled && !p.loading && <div className="banner warn" role="status">{p.reason ?? "Betting is unavailable."}</div>}

      <div className="grid">
        <div className="col">
          <div className="row between">
            <label className="lbl" htmlFor="bet">Amount</label>
            <span className="lbl mono">Bal {p.connected ? (p.balance === null ? "…" : `${lamportsToSol(p.balance, 3)}`) : "—"}</span>
          </div>
          <div className="amount notch-sm">
            <input id="bet" className="mono" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={p.amount} disabled={busy}
              onChange={(e) => { const v = e.target.value.replace(",", "."); if (/^\d*\.?\d{0,9}$/.test(v)) p.setAmount(v); }}
              aria-invalid={!!problem && p.connected} />
            <span className="token">◎ SOL</span>
          </div>
          <div className="quick" role="group" aria-label="Quick amounts">
            {QUICK.map((q) => {
              const l = solToLamports(q)!;
              const over = p.enabled && p.maxBet > 0n && l > p.maxBet;
              return (
                <button key={q} type="button" className={`q notch-xs ${p.amount === q ? "on" : ""}`} aria-pressed={p.amount === q}
                  disabled={busy || over} title={over ? "Above the current max bet" : undefined} onClick={() => p.setAmount(q)}>{q}</button>
              );
            })}
          </div>
        </div>

        <div className="col">
          <span className="lbl">Your side</span>
          <div className="sides" role="radiogroup" aria-label="Choose a side">
            {(["heads", "tails"] as Side[]).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={p.side === s} disabled={busy}
                className={`side notch-sm ${p.side === s ? "on" : ""}`} onClick={() => p.setSide(s)}>
                <b aria-hidden="true">{s === "heads" ? "H" : "T"}</b>
                <span>{s.toUpperCase()}</span>
              </button>
            ))}
          </div>
          <dl className="receipt mono" aria-live="polite">
            <div><dt>Gross payout · 2×</dt><dd>{pv ? lamportsToSol(pv.gross, 4) : "—"}</dd></div>
            <div><dt>Platform fee · 3%</dt><dd>{pv ? `−${lamportsToSol(pv.fee, 4)}` : "—"}</dd></div>
            <div className="net"><dt>You win</dt><dd>{pv ? `${lamportsToSol(pv.netPayout, 4)} SOL` : "—"}</dd></div>
          </dl>
        </div>
      </div>

      {p.connected && problem && <p className="err" role="alert">{problem}</p>}

      {p.connected ? (
        <button className="btn btn-primary notch flip" disabled={!canFlip} aria-busy={busy} onClick={p.onFlip}>
          <span>{p.loading ? "LOADING…" : PHASE_LABEL[p.phase]}</span>
        </button>
      ) : (
        <button className="btn btn-primary notch flip" onClick={p.onConnect}><span>CONNECT WALLET</span></button>
      )}
    </section>
  );
}
