import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Network } from "../../shared/protocol.js";

const RPC: Record<Network, string> = {
  devnet: (import.meta.env.VITE_RPC_DEVNET as string) || "https://api.devnet.solana.com",
  "mainnet-beta": (import.meta.env.VITE_RPC_MAINNET as string) || "https://api.mainnet-beta.solana.com",
};
const KEY = "ffflip:network";

interface Ctx { network: Network; rpc: string; setNetwork: (n: Network) => void; explorerTx: (sig: string) => string; explorerAddr: (a: string) => string }
const C = createContext<Ctx | null>(null);

const initial = (): Network => {
  try { const v = localStorage.getItem(KEY); if (v === "devnet" || v === "mainnet-beta") return v; } catch { /* ignore */ }
  return "devnet";
};

export function NetworkProvider({ children }: { children: (rpc: string) => ReactNode }) {
  const [network, set] = useState<Network>(initial);
  const setNetwork = useCallback((n: Network) => { set(n); try { localStorage.setItem(KEY, n); } catch { /* ignore */ } }, []);
  const value = useMemo<Ctx>(() => {
    const q = network === "mainnet-beta" ? "" : `?cluster=${network}`;
    return { network, rpc: RPC[network], setNetwork, explorerTx: (s) => `https://explorer.solana.com/tx/${s}${q}`, explorerAddr: (a) => `https://explorer.solana.com/address/${a}${q}` };
  }, [network, setNetwork]);
  return <C.Provider value={value}>{children(value.rpc)}</C.Provider>;
}

export function useNetwork() {
  const c = useContext(C);
  if (!c) throw new Error("NetworkProvider missing");
  return c;
}
