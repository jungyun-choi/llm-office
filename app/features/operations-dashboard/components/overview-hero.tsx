import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, Cpu, Gauge } from "lucide-react";

import { UI_COPY } from "../copy";
import type { Task } from "../types";

interface OverviewHeroProps {
  tasks: Task[];
}

export function OverviewHero({ tasks }: OverviewHeroProps) {
  const urgent = tasks.filter((task) => task.priority === "urgent").length;
  const approvals = tasks.filter((task) => task.stage === "approval").length + 2;
  const blocked = tasks.filter((task) => task.blockedReason).length;
  const metrics = [
    { label: "진행 중 업무", value: `${tasks.length - 1}`, detail: "오늘 +2", icon: Cpu, tone: "blue" },
    { label: "승인 대기", value: `${approvals}`, detail: "최장 2h 08m", icon: Clock3, tone: "amber" },
    { label: "긴급 우선순위", value: `${urgent}`, detail: "오늘 마감", icon: AlertTriangle, tone: "rose" },
    { label: "파이프라인 건강도", value: `${100 - blocked * 4}%`, detail: "안정", icon: Gauge, tone: "teal" },
  ];
  return (
    <section className="overview-hero" id="overview" aria-labelledby="overview-title">
      <div className="overview-heading"><div><span className="eyebrow">{UI_COPY.pageEyebrow}</span><h1 id="overview-title">{UI_COPY.pageTitle}</h1><p>{UI_COPY.pageDescription}</p></div><div className="overview-time"><span>{UI_COPY.localTime}</span><strong><CheckCircle2 size={15} />{UI_COPY.systemHealthy}</strong></div></div>
      <div className="metric-grid">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</div>
    </section>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Cpu; tone: string }) {
  return <article className={`metric-card metric-card--${tone}`}><div className="metric-card__icon"><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong></div><small>{detail}<ArrowUpRight size={12} /></small></article>;
}
