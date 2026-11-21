import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AsciiBackground } from "./components/AsciiBackground";
import { Header } from "./components/Header";
import { Coin, CoinState } from "./components/Coin";
import { BetPanel, UiPhase, validate } from "./components/BetPanel";
import { Modal } from "./components/Modal";
import { useBalance } from "./wallet/useBalance";
import { useNetwork } from "./wallet/network";
import { createSettlementClient } from "./game/clients";
import { lamportsToSol, solToLamports } from "./game/fees";
import { FlipOutcome, HouseConfig, Network, Side, friendlyError } from "./game/settlement";

const OFF: HouseConfig = { enabled: false, house: null, minBet: 0n, maxBet: 0n, commitment: null };

export default function App() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const { network, setNetwork, explorerTx, explorerAddr } = useNetwork();
  const { lamports: balance, error: balanceError, refresh } = useBalance();

  const client = useMemo(() => createSettlementClient(network), [network]);
  const [cfg, setCfg] = useState<HouseConfig>(OFF);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [amount, setAmount] = useState("0.1");
  const [side, setSide] = useState<Side | null>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [outcome, setOutcome] = useState<FlipOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const [gap, setGap] = useState<{ x: number; y: number } | null>(null);
  const [confirmMain, setConfirmMain] = useState(false);
  const inFlight = useRef(false); // hard guard against double submission

  const loadConfig = useCallback(async () => {
    const c = await client.getConfig().catch(() => OFF);
    setCfg(c); setCfgLoading(false);
  }, [client]);

  useEffect(() => {
    setCfgLoading(true); setCfg(OFF); setOutcome(null); setError(null);
    loadConfig();
    const id = window.setInterval(loadConfig, 60_000);
    return () => window.clearInterval(id);
  }, [loadConfig]);

  const chooseNetwork = (n: Network) => {
    if (inFlight.current || n === network) return;
    if (n === "mainnet-beta") setConfirmMain(true); else setNetwork(n);
  };

  const onFlip = useCallback(async () => {
    if (inFlight.current || !publicKey) return;
    const l = solToLamports(amount);
    const bad = validate({ connected, amount, side, balance, minBet: cfg.minBet, maxBet: cfg.maxBet, enabled: cfg.enabled });
    if (bad || !l || !side) { setError(bad ?? "Invalid bet."); return; }
    inFlight.current = true;
    setError(null); setOutcome(null); setPhase("signing");
    try {
      const res = await client.placeBet({
        wallet: { publicKey, connection, signAndSend: (tx) => sendTransaction(tx, connection) },
        side, lamports: l, onPhase: (p) => setPhase(p),
      });
      setOutcome(res);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPhase("idle");
      inFlight.current = false;
      refresh(); loadConfig();
    }
  }, [amount, side, publicKey, connected, balance, cfg, client, connection, sendTransaction, refresh, loadConfig]);

  const mainnet = network === "mainnet-beta";
  const coinState: CoinState = phase !== "idle" ? "flipping" : outcome ? "landed" : "idle";
  const verdict = outcome ? (outcome.refunded ? "refund" : outcome.won ? "win" : "loss") : null;

  return (
    <div className={`app ${mainnet ? "is-main" : ""}`}>
      <div className="top" style={gap ? ({ "--gap-x": `${gap.x}px`, "--gap-y": `${gap.y}px` } as React.CSSProperties) : undefined}>
        <AsciiBackground onPlaceholder={setPlaceholder} onGap={setGap} />
        <div className="scrim" aria-hidden="true" />
        <Header balance={balance} balanceError={balanceError} network={network} onNetwork={chooseNetwork} />
        <section className="hero">
          <h1>TWO SIDES.<br /><span>ONE FLIP.</span></h1>
          <p>Choose your side. Place your bet. Double your wager if you win.</p>
        </section>

        <div className="coin-slot">
          <Coin state={coinState} landed={outcome?.landed ?? undefined} />
          {outcome && verdict && phase === "idle" && (
            <div className={`result notch-sm ${verdict}`} role="status">
              <strong>{verdict === "win" ? "WIN" : verdict === "loss" ? "LOSS" : "REFUNDED"}</strong>
              <span className="mono">
                {verdict === "win" ? `+${lamportsToSol(outcome.payout, 4)} SOL paid out`
                  : verdict === "loss" ? `−${lamportsToSol(outcome.wager, 4)} SOL`
                  : outcome.reason ?? "Bet returned"}
              </span>
              {outcome.signature !== "DEMO"
                ? <a href={explorerTx(outcome.payoutSignature ?? outcome.signature)} target="_blank" rel="noreferrer">{outcome.payoutSignature ? "Payout tx ↗" : "Bet tx ↗"}</a>
                : <em>demo result</em>}
              <button className="link" onClick={() => setOutcome(null)}>Dismiss</button>
            </div>
          )}
          {phase !== "idle" && (
            <div className="result notch-sm pending" role="status"><span className="mono">
              {phase === "signing" ? "Waiting for wallet signature…" : phase === "confirming" ? "Confirming transaction…" : "Settling flip…"}
            </span></div>
          )}
        </div>
      </div>

      <main className="main">
        <BetPanel
          connected={connected} balance={balance} amount={amount} setAmount={setAmount}
          side={side} setSide={setSide} minBet={cfg.minBet} maxBet={cfg.maxBet}
          phase={phase} enabled={cfg.enabled} reason={cfg.reason} loading={cfgLoading}
          simulated={client.simulated} mainnet={mainnet}
          onConnect={() => setVisible(true)} onFlip={onFlip}
        />
        {error && <p className="toast err notch-sm" role="alert" onClick={() => setError(null)}>{error}</p>}
      </main>

      <footer className="ftr">
        <span>3% platform fee per flip</span>
        <details>
          <summary>How to play</summary>
          <p>Pick Heads or Tails, set a bet, and flip. Your wallet sends the wager to the house; if you win you receive 2× your wager minus the platform fee, otherwise the wager is forfeited.</p>
        </details>
        {cfg.commitment && (
          <details>
            <summary>Fairness</summary>
            <p>The outcome is HMAC-SHA256(house secret, your bet's transaction signature), so it is fixed by your transaction and cannot be known in advance. The house secret's hash (commitment): <span className="mono">{cfg.commitment.slice(0, 16)}…</span>. This is a house-operated game; the secret is not yet revealed on-chain.</p>
          </details>
        )}
        {cfg.house && <a href={explorerAddr(cfg.house)} target="_blank" rel="noreferrer">House wallet ↗</a>}
        <span>18+ · Play responsibly · Only bet what you can afford to lose</span>
        {placeholder && <span className="dev">placeholder artwork — add public/hands.png</span>}
      </footer>

      <Modal open={confirmMain} title="Switch to Mainnet?" confirmLabel="I understand, switch"
        onCancel={() => setConfirmMain(false)} onConfirm={() => { setConfirmMain(false); setNetwork("mainnet-beta"); }}>
        <p>Mainnet uses <b>real SOL</b>. Bets are final and losses cannot be reversed. Only play with money you can afford to lose, and only if gambling is legal where you live.</p>
      </Modal>
    </div>
  );
}
