import { Suspense, lazy, useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Nav from "./common/Nav";
import Footer from "./common/Footer";
import Portal from "./portal/Portal";
import { RouteFallback } from "./common/State";
import { api } from "./lottery/api";
import { LotteryInfo } from "./lottery/types";
import { LotteryCtx } from "./lottery/context";
import { ThemeCtx, useThemeState } from "./common/useTheme";
import { usePageTrack } from "./common/usePageTrack";

/**
 * 路由级代码分割。
 *
 * 为什么必须拆（2026-10-29 实测，改回单个 import 前先复读）：
 *   改造前 15 个路由全是静态 import → 一个 1.24 MB 的 bundle（gzip 362 KB），
 *   而 recharts（/access 图表、/lottery 走势）和 react-markdown + remark/rehype
 *   （/tools 排版）两坨几乎占了六成。**任何一页都要先把它们下完**，实测
 *   首屏 JS 下载 4.16 s，占 /deals 7.3 s 总耗时的 57%。
 *   → 除门户首页（Portal，首屏必看）外全部改按需加载，未访问的页面一条字节不下。
 *
 * ⚠️ 别把 Portal 也改成 lazy：它是 `/` 的落地页，多一次 chunk 往返等于把首屏
 *   最关键的渲染往后推一个 RTT（当前链路 RTT 244 ms）。
 */
const Home = lazy(() => import("./lottery/pages/Home"));
const History = lazy(() => import("./lottery/pages/History"));
const Predict = lazy(() => import("./lottery/pages/Predict"));
const Algorithms = lazy(() => import("./lottery/pages/Algorithms"));
const HanziPlayer = lazy(() => import("./hanzi/HanziPlayer"));
const Trigger = lazy(() => import("./trigger/Trigger"));
const BabySong = lazy(() => import("./babysong/BabySong"));
const BabySongAdmin = lazy(() => import("./babysong/BabySongAdmin"));
const StoryPage = lazy(() => import("./story/Story"));
const StoryAdmin = lazy(() => import("./story/StoryAdmin"));
const Access = lazy(() => import("./access/Access"));
const Tools = lazy(() => import("./tools/Tools"));
const Deals = lazy(() => import("./deals/Deals"));
const DealsAdmin = lazy(() => import("./deals/DealsAdmin"));

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

  // 在门户首页空闲时预取「捡漏」的 chunk：它是最常点的入口，
  // 提前下好之后点进去就不用等代码。只从 `/` 触发 —— 别的页面用户不会往 /deals 走，
  // 无条件预取等于给所有访问者白送一次请求。
  // 用 requestIdleCallback 而不是 setTimeout：不抢首屏带宽，浏览器忙就往后挪。
  useEffect(() => {
    if (pageKey !== "/") return;
    const warm = () => void import("./deals/Deals");
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => number })
      .requestIdleCallback;
    if (ric) ric(warm, { timeout: 2500 });
    else setTimeout(warm, 1500);
  }, [pageKey]);

  return (
    <ThemeCtx.Provider value={theme}>
      <LotteryCtx.Provider value={{ lotteries, key, setKey }}>
        <div className="bg-aurora min-h-screen">
          <Nav />
          <main className="mx-auto max-w-6xl px-5 pb-10">
            <div key={pageKey} className="anim-page-in">
              {/* Suspense 放在 key 容器内：路由切换时容器重挂载，fallback 才会跟着重新走一遍，
                  否则从 A 页切到慢 chunk 的 B 页时，A 的内容会一直挂着不消失。 */}
              <Suspense fallback={<RouteFallback />}>
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
                  <Route path="/tools" element={<Tools />} />
                  <Route path="/deals" element={<Deals />} />
                  <Route path="/deals-admin" element={<DealsAdmin />} />
                  {/* 兼容旧链接：/ 原为彩票首页，现统一指向聚合门户 */}
                  <Route path="*" element={<Portal />} />
                </Routes>
              </Suspense>
            </div>
          </main>
          <Footer />
        </div>
      </LotteryCtx.Provider>
    </ThemeCtx.Provider>
  );
}
