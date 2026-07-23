import { MessageCircleQuestion, MonitorUp, X } from "lucide-react";
import type { ReactNode } from "react";

interface MeetingRoomProps {
  id: string;
  className?: string;
  theme: "orbit" | "development";
  eyebrow: string;
  title: string;
  description: string;
  hostName: string;
  hostRole: string;
  hostModel?: string;
  sourceLabel?: string;
  modal?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function MeetingRoom(props: MeetingRoomProps) {
  return (
    <section
      className={["meeting-room", `meeting-room--${props.theme}`, props.className].filter(Boolean).join(" ")}
      aria-labelledby={props.id}
      role={props.modal ? "dialog" : undefined}
      aria-modal={props.modal ? "true" : undefined}
    >
      <div className="meeting-room__scene" aria-hidden="true">
        <span className="meeting-room__window"><i /><i /><i /></span>
        <span className="meeting-room__screen">
          <MonitorUp size={16} />
          <small>SHARED BRIEF</small>
        </span>
        <span className="meeting-room__person meeting-room__person--host"><i /><b /></span>
        <span className="meeting-room__person meeting-room__person--human"><i /><b /></span>
        <span className="meeting-room__table"><i /><b /></span>
        <span className="meeting-room__nameplate meeting-room__nameplate--host">{props.hostName}</span>
        <span className="meeting-room__nameplate meeting-room__nameplate--human">YOU</span>
      </div>
      <header className="meeting-room__header">
        <span className="meeting-room__avatar"><MessageCircleQuestion size={20} aria-hidden="true" /></span>
        <div>
          <small>{props.eyebrow}</small>
          <strong id={props.id}>{props.title}</strong>
          <p>{props.description}</p>
          <div className="meeting-room__host">
            <span>{props.hostName}</span>
            <i>{props.hostRole}</i>
            {props.hostModel && <em>{props.hostModel}</em>}
          </div>
          {props.sourceLabel && <span className="meeting-room__source">{props.sourceLabel}</span>}
        </div>
        <button className="meeting-room__close" type="button" onClick={props.onClose} aria-label={`${props.title} 닫기`}>
          <X size={15} aria-hidden="true" />
          <span>닫기</span>
        </button>
      </header>
      <div className="meeting-room__conversation">{props.children}</div>
    </section>
  );
}
