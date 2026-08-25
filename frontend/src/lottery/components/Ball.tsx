interface BallProps {
  n: number;
  kind?: "red" | "blue";
  size?: number;
  delay?: number;
}

export default function Ball({ n, kind = "red", size = 44, delay = 0 }: BallProps) {
  const isRed = kind === "red";
  const colors = isRed
    ? "from-brand-red to-brand-red2 shadow-glow"
    : "from-brand-blue to-brand-blue2 shadow-glowblue";
  const fs = size * 0.4;
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full bg-gradient-to-br ${colors} font-bold text-white animate-rise`}
      style={{
        width: size,
        height: size,
        fontSize: fs,
        margin: 4,
        animationDelay: `${delay}ms`,
        boxShadow: isRed
          ? "0 6px 18px -4px rgba(226,59,82,0.35)"
          : "0 6px 18px -4px rgba(37,99,235,0.35)",
      }}
    >
      {n}
    </div>
  );
}
