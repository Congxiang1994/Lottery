module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans SC",
          "PingFang SC",
          "-apple-system",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      colors: {
        ink: {
          900: "#070810",
          800: "#0c0e16",
          700: "#13161f",
          600: "#1b1f2b",
          500: "#272c3a",
        },
        brand: {
          red: "#ff3b5c",
          red2: "#ff7a45",
          blue: "#3b82f6",
          blue2: "#22d3ee",
          gold: "#f5c451",
        },
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(255,59,92,0.45)",
        glowblue: "0 0 40px -8px rgba(59,130,246,0.45)",
        card: "0 12px 40px -12px rgba(0,0,0,0.6)",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%,100%": { transform: "scale(1.3)", opacity: "0" },
        },
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(200%)" },
          "100%": { transform: "translateX(-100%)" },
        },
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        rise: "rise 0.7s cubic-bezier(0.22,1,0.36,1) both",
        shimmer: "shimmer 3s linear infinite",
        pulseRing: "pulseRing 2.4s cubic-bezier(0.4,0,0.2,1) infinite",
        indeterminate: "indeterminate 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
