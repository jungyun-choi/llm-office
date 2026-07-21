"use client";

import { Building2, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";

import { OFFICE_COPY } from "./copy";

interface OfficeErrorBoundaryProps {
  children: ReactNode;
}

interface OfficeErrorBoundaryState {
  hasError: boolean;
}

export class OfficeErrorBoundary extends Component<OfficeErrorBoundaryProps, OfficeErrorBoundaryState> {
  public state: OfficeErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): OfficeErrorBoundaryState {
    return { hasError: true };
  }

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="office-error" id="main-content">
        <Building2 size={31} aria-hidden="true" />
        <h1>{OFFICE_COPY.error.title}</h1>
        <p>{OFFICE_COPY.error.description}</p>
        <button type="button" onClick={() => window.location.reload()}>
          <RotateCcw size={16} aria-hidden="true" />{OFFICE_COPY.error.retry}
        </button>
      </main>
    );
  }
}
