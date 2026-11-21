import { Side } from "../game/settlement";

export type CoinState = "idle" | "flipping" | "landed";

interface Props {
  state: CoinState;
  landed?: Side;
}

/** CSS 3D coin. Idle floats, flipping spins, landed rests on the settled side. */
export function Coin({ state, landed }: Props) {
  const rest = landed === "tails" ? 180 : 0;
  return (
    <div className="coin-wrap" data-state={state}>
      <div
        className="coin"
        style={state === "landed" ? ({ ["--rest" as string]: `${rest}deg` } as React.CSSProperties) : undefined}
      >
        <div className="coin-face front"><span>H</span><small>HEADS</small></div>
        <div className="coin-face back"><span>T</span><small>TAILS</small></div>
        {Array.from({ length: 8 }).map((_, i) => (
          <i key={i} className="coin-edge" style={{ ["--i" as string]: i } as React.CSSProperties} />
        ))}
      </div>
      <div className="coin-shadow" />
    </div>
  );
}
