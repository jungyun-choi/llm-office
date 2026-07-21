import {
  Activity,
  Files,
  LayoutDashboard,
  ListChecks,
  Radio,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { NAV_ITEMS, UI_COPY } from "../copy";

interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_ICONS: Record<(typeof NAV_ITEMS)[number]["id"], LucideIcon> = {
  overview: LayoutDashboard,
  queue: ListChecks,
  pipeline: Workflow,
  outputs: Files,
};

export function AppSidebar({ isOpen, onClose }: AppSidebarProps) {
  return (
    <>
      <aside className={`app-sidebar ${isOpen ? "app-sidebar--open" : ""}`}>
        <SidebarBrand onClose={onClose} />
        <SidebarNavigation onClose={onClose} />
        <SidebarSignal />
      </aside>
      {isOpen && <button className="sidebar-scrim" onClick={onClose} aria-label={UI_COPY.mobileMenuClose} />}
    </>
  );
}

function SidebarBrand({ onClose }: Pick<AppSidebarProps, "onClose">) {
  return (
    <div className="sidebar-brand">
      <div className="sidebar-brand__mark" aria-hidden="true"><Activity size={19} strokeWidth={2.2} /></div>
      <div><strong>{UI_COPY.productName}</strong><span>{UI_COPY.productDescriptor}</span></div>
      <button className="icon-button sidebar-close" onClick={onClose} aria-label={UI_COPY.mobileMenuClose}><X size={19} /></button>
    </div>
  );
}

function SidebarNavigation({ onClose }: Pick<AppSidebarProps, "onClose">) {
  return (
    <nav className="sidebar-nav" aria-label={UI_COPY.navigationLabel}>
      <span className="sidebar-label">WORKSPACE</span>
      {NAV_ITEMS.map((item, index) => {
        const Icon = NAV_ICONS[item.id];
        return <a key={item.id} className={`sidebar-nav__item ${index === 0 ? "is-active" : ""}`} href={`#${item.id}`} onClick={onClose}><Icon size={17} /><span>{item.label}</span>{index === 1 && <b>7</b>}</a>;
      })}
    </nav>
  );
}

function SidebarSignal() {
  return (
    <div className="sidebar-signal">
      <div className="sidebar-signal__header"><span><Radio size={14} /> 작업 신호</span><b>LIVE</b></div>
      <div className="signal-row"><span>활성 에이전트</span><strong>4 / 6</strong></div>
      <div className="signal-row"><span>평균 응답</span><strong>1.8s</strong></div>
      <div className="signal-meter" role="progressbar" aria-label="작업 용량" aria-valuemin={0} aria-valuemax={100} aria-valuenow={64}><span style={{ width: "64%" }} /></div>
      <p>오늘 작업 용량의 64% 사용 중</p>
    </div>
  );
}
