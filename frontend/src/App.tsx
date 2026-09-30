import { useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Nav from "./common/Nav";
import Footer from "./common/Footer";
import Portal from "./portal/Portal";
import Home from "./lottery/pages/Home";
import History from "./lottery/pages/History";
import Predict from "./lottery/pages/Predict";
import Algorithms from "./lottery/pages/Algorithms";
import HanziPlayer from "./hanzi/HanziPlayer";
import Trigger from "./trigger/Trigger";
import BabySong from "./babysong/BabySong";
import BabySongAdmin from "./babysong/BabySongAdmin";
import StoryPage from "./story/Story";
import StoryAdmin from "./story/StoryAdmin";
import Access from "./access/Access";
import { api } from "./lottery/api";
import { LotteryInfo } from "./lottery/types";
import { LotteryCtx } from "./lottery/context";
import { ThemeCtx, useThemeState } from "./common/useTheme";
import { usePageTrack } from "./common/usePageTrack";

export default function App() {
  const [lotteries, setLotteries] = useState<LotteryInfo[]>([]);
  const [key, setKey] = useState("ssq");
  const theme = useThemeState();
  // 路由切换时 key 变化 → 内容容器重挂载，统一播放页面入场动画
  const location = useLocation();
  const pageKey = location.pathname;
  // 页面级访问埋点（访问管理 /access 的数据来源之一；自动化环境自动跳过）
  usePageTrack();

  useEffect(() => {
    api.lotteries().then(setLotteries).catch(() => {
      setLotteries([
        { key: "ssq", name: "双色球", org: "中国福利彩票", red_label: "红球", blue_label: "蓝球" },
        { key: "dlt", name: "大乐透", org: "中国体育彩票", red_label: "前区", blue_label: "后区" },
      ]);
    });
  }, []);

  return (
    <ThemeCtx.Provider value={theme}>
      <LotteryCtx.Provider value={{ lotteries, key, setKey }}>
        <div className="bg-aurora min-h-screen">
          <Nav />
          <main className="mx-auto max-w-6xl px-5 pb-10">
            <div key={pageKey} className="anim-page-in">
              <Routes>
              <Route path="/" element={<Portal />} />
              <Route path="/lottery" element={<Home />} />
              <Route path="/history" element={<History />} />
              <Route path="/predict" element={<Predict />} />
              <Route path="/algorithms" element={<Algorithms />} />
              <Route path="/hanzi" element={<HanziPlayer />} />
              <Route path="/trigger" element={<Trigger />} />
              <Route path="/babysong" element={<BabySong />} />
              <Route path="/babysong-admin" element={<BabySongAdmin />} />
              <Route path="/story" element={<StoryPage />} />
              <Route path="/story-admin" element={<StoryAdmin />} />
              <Route path="/access" element={<Access />} />
              {/* 兼容旧链接：/ 原为彩票首页，现统一指向聚合门户 */}
              <Route path="*" element={<Portal />} />
              </Routes>
            </div>
          </main>
          <Footer />
        </div>
      </LotteryCtx.Provider>
    </ThemeCtx.Provider>
  );
}
