import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
class EB extends React.Component<{children: any}, {e: any}> {
  state = { e: null };
  static getDerivedStateFromError(e: any) { return { e }; }
  componentDidCatch(e: any, i: any) { (window as any).__ebc = String(e?.stack || e) + " || " + String(i?.componentStack || ""); }
  render() { return this.state.e ? React.createElement("pre",{style:{color:"red",padding:20,whiteSpace:"pre-wrap",background:"#fff"}}, String(this.state.e.stack || this.state.e) + "\n\n" + ((window as any).__ebc||"")) : this.props.children; }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><BrowserRouter><EB><App /></EB></BrowserRouter></React.StrictMode>
);
