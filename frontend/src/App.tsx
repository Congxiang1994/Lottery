import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Portal from "./pages/Portal";
import Home from "./pages/Home";
import History from "./pages/History";
import Predict from "./pages/Predict";
import Algorithms from "./pages/Algorithms";
import EduPortal from "./edu/EduPortal";
import EduBrowse from "./edu/Browse";
import EduTasks from "./edu/Tasks";
import EduFiles from "./edu/Files";
import EduSettings from "./edu/Settings";
import { api } from "./api";
import { LotteryInfo } from "./types";

interface Ctx {
  lotteries: LotteryInfo[];
  key: string;
  setKey: (k: string) => void;
}

const LotteryCtx = createContext<Ctx>({ lotteries: [], key: "ssq", setKey: () => {} });
export const useLottery = () => useContext(LotteryCtx);

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
            {/* 智慧教育资源下载助手（edu 模块） */}
            <Route path="/edu" element={<EduPortal />} />
            <Route path="/edu/browse" element={<EduBrowse />} />
            <Route path="/edu/tasks" element={<EduTasks />} />
            <Route path="/edu/files" element={<EduFiles />} />
            <Route path="/edu/settings" element={<EduSettings />} />
            {/* 兼容旧链接：/ 原为彩票首页，现统一指向聚合门户 */}
            <Route path="*" element={<Portal />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </LotteryCtx.Provider>
  );
}
