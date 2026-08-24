import { createContext, useContext } from "react";
import { LotteryInfo } from "./types";

interface Ctx {
  lotteries: LotteryInfo[];
  key: string;
  setKey: (k: string) => void;
}

export const LotteryCtx = createContext<Ctx>({
  lotteries: [],
  key: "ssq",
  setKey: () => {},
});

export const useLottery = () => useContext(LotteryCtx);
