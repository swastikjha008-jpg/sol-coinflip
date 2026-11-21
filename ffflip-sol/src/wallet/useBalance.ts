import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

/** Real on-chain SOL balance in lamports; null while unknown / disconnected. */
export function useBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [lamports, setLamports] = useState<bigint | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) { setLamports(null); return; }
    try { setLamports(BigInt(await connection.getBalance(publicKey, "confirmed"))); setError(false); }
    catch { setError(true); }
  }, [connection, publicKey]);

  useEffect(() => {
    setLamports(null);
    if (!publicKey) return;
    refresh();
    let id: number | undefined;
    try {
      id = connection.onAccountChange(publicKey, (a) => { setLamports(BigInt(a.lamports)); setError(false); }, "confirmed");
    } catch { /* polling fallback below */ }
    const poll = window.setInterval(refresh, 30_000);
    return () => {
      window.clearInterval(poll);
      if (id !== undefined) connection.removeAccountChangeListener(id).catch(() => {});
    };
  }, [connection, publicKey, refresh]);

  return { lamports, error, refresh };
}
