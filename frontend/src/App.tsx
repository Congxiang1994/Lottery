import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Nav from "./common/Nav";
import Footer from "./common/Footer";
import Portal from "./portal/Portal";
import Home from "./lottery/pages/Home";
import History from "./lottery/pages/History";
import Predict from "./lottery/pages/Predict";
import Algorithms from "./lottery/pages/Algorithms";
import HanziPlayer from "./hanzi/HanziPlayer";
import HanziPlayPage from "./hanzi/HanziPlayPage";
import { api } from "./lottery/api";
import { LotteryInfo } from "./lottery/types";
import { LotteryCtx } from "./lottery/context";

export default function App() {
  const [lotteries, setLotteries] = useState<LotteryInfo[]>([]);
  const [key, setKey] = useState("ssq");

  useEffect(() => {
    api.lotteries().then(setLotteries).catch(() => {
      setLotteries([
        { key: "ssq", name: "双色球", org: "中国福利彩票", red_label: "红球", blue_label: "蓝球" },
        { key: "dlt", name: "大乐透", org: "中国体育彩票", red_label: "前区", blue_label: "后区" },
      ]);
    });
  }, []);

  return (
    <LotteryCtx.Provider value={{ lotteries, key, setKey }}>
      <div className="bg-aurora min-h-screen">
        <Nav />
        <main className="mx-auto max-w-6xl px-5 pb-10">
          <Routes>
            <Route path="/" element={<Portal />} />
            <Route path="/lottery" element={<Home />} />
            <Route path="/history" element={<History />} />
            <Route path="/predict" element={<Predict />} />
            <Route path="/algorithms" element={<Algorithms />} />
            <Route path="/hanzi" element={<HanziPlayer />} />
            <Route path="/hanzi/:num" element={<HanziPlayPage />} />
            {/* 兼容旧链接：/ 原为彩票首页，现统一指向聚合门户 */}
            <Route path="*" element={<Portal />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </LotteryCtx.Provider>
  );
}
