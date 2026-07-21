import { Bell, Menu, Plus, Search, SlidersHorizontal } from "lucide-react";

import { UI_COPY } from "../copy";

interface DashboardHeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  onMenuOpen: () => void;
  onFilterOpen: () => void;
  onNotificationsOpen: () => void;
  onNewTask: () => void;
}

export function DashboardHeader({
  search,
  onSearchChange,
  onMenuOpen,
  onFilterOpen,
  onNotificationsOpen,
  onNewTask,
}: DashboardHeaderProps) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu-button" onClick={onMenuOpen} aria-label={UI_COPY.mobileMenuOpen}><Menu size={20} /></button>
      <div className="workspace-identity"><span>{UI_COPY.workspaceCode}</span><strong>{UI_COPY.workspaceName}</strong></div>
      <label className="global-search">
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">{UI_COPY.searchPlaceholder}</span>
        <input id="global-work-search" type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={UI_COPY.searchPlaceholder} />
        <kbd>{UI_COPY.searchShortcut}</kbd>
      </label>
      <div className="topbar-actions">
        <button className="icon-button filter-button" onClick={onFilterOpen} aria-label="업무 필터로 이동"><SlidersHorizontal size={18} /></button>
        <button className="icon-button notification-button" onClick={onNotificationsOpen} aria-label="긴급 승인 알림 3개 열기"><Bell size={18} /><span>3</span></button>
        <button className="primary-button" onClick={onNewTask}><Plus size={17} />{UI_COPY.newTask}</button>
      </div>
    </header>
  );
}
