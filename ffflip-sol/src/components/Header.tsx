import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { lamportsToSol } from "../game/fees";
import type { Network } from "../game/settlement";

interface Props { balance: bigint | null; balanceError: boolean; network: Network; onNetwork: (n: Network) => void }

export function Header({ balance, balanceError, network, onNetwork }: Props) {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const addr = publicKey?.toBase58();
  const short = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "";
  const main = network === "mainnet-beta";

  return (
    <header className="hdr">
      <div className="brand" aria-label="FFFLIP SOL">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-word">FFFLIP</span><span className="brand-sol">SOL</span>
      </div>

      <div className="hdr-right">
        <div className={`seg ${main ? "is-main" : ""}`} role="radiogroup" aria-label="Network">
          <span className="seg-thumb" aria-hidden="true" />
          <button role="radio" aria-checked={!main} className={!main ? "on" : ""} onClick={() => onNetwork("devnet")}>DEVNET</button>
          <button role="radio" aria-checked={main} className={main ? "on" : ""} onClick={() => onNetwork("mainnet-beta")}>MAINNET</button>
        </div>

        {connected ? (
          <button className="btn btn-glass notch-sm wallet" onClick={() => disconnect()} title="Disconnect wallet">
            <i className="dot" />
            <span className="mono">{short}</span>
            <span className="sep" />
            <span className="mono">{balance === null ? (balanceError ? "n/a" : "…") : `${lamportsToSol(balance, 3)} SOL`}</span>
          </button>
        ) : (
          <button className="btn btn-primary notch-sm" onClick={() => setVisible(true)} disabled={connecting}>
            {connecting ? "CONNECTING…" : "CONNECT WALLET"}
          </button>
        )}
      </div>
    </header>
  );
}
