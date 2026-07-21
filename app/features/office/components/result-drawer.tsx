"use client";

import { FileText, Info, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { OFFICE_COPY } from "../copy";
import type { OfficeResult } from "../types";
import { IssueDraftCard } from "./issue-draft-card";
import { ResultEngineCard } from "./result-engine-card";
import { RoleOutputList } from "./role-output-list";
import { WorkBreakdown } from "./work-breakdown";

interface ResultDrawerProps {
  result: OfficeResult | null;
  onClose: () => void;
}

export function ResultDrawer({ result, onClose }: ResultDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!result) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") keepFocusInsideDrawer(event, drawerRef.current);
    };
    document.body.classList.add("is-modal-open");
    document.addEventListener("keydown", handleKeyDown);
    const frameId = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frameId);
      document.body.classList.remove("is-modal-open");
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, result]);

  if (!result) return null;

  return (
    <div className="result-drawer-layer">
      <button
        className="result-drawer-scrim"
        type="button"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />
      <section
        ref={drawerRef}
        className="result-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-drawer-title"
      >
        <header>
          <div>
            <span>{OFFICE_COPY.drawer.eyebrow}</span>
            <h2 id="result-drawer-title">{result.title}</h2>
            <p>{result.createdAt} · {OFFICE_COPY.drawer.syntheticNotice}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={OFFICE_COPY.drawer.close}>
            <X size={19} />
          </button>
        </header>
        <div className="result-drawer__content">
          <div className="result-request">
            <FileText size={17} aria-hidden="true" />
            <div><span>{OFFICE_COPY.drawer.requestLabel}</span><p>{result.request}</p></div>
          </div>
          <p className="result-summary">{result.summary}</p>
          <ResultEngineCard engine={result.engine} />
          <RoleOutputList outputs={result.roleOutputs} />
          <div className="result-sections">
            {result.sections.map((section) => (
              <section key={section.label}>
                <h3>{section.label}</h3>
                <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ))}
          </div>
          <WorkBreakdown items={result.workItems} />
          <IssueDraftCard issue={result.issueDraft} />
          <section className="result-notices" aria-label={OFFICE_COPY.drawer.noticesLabel}>
            <Info size={15} aria-hidden="true" />
            <div>{result.notices.map((notice) => <p key={notice}>{notice}</p>)}</div>
          </section>
        </div>
      </section>
    </div>
  );
}

function keepFocusInsideDrawer(event: KeyboardEvent, drawer: HTMLElement | null): void {
  if (!drawer) return;
  const focusable = Array.from(drawer.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "summary",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(","))).filter((element) => !element.closest("[hidden]") && !element.hasAttribute("aria-hidden"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;

  const activeElement = document.activeElement;
  if (event.shiftKey && (activeElement === first || !drawer.contains(activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (activeElement === last || !drawer.contains(activeElement))) {
    event.preventDefault();
    first.focus();
  }
}
