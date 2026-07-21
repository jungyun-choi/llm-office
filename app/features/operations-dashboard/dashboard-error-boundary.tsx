"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Component, type ReactNode } from "react";

import { UI_COPY } from "./copy";

interface DashboardErrorBoundaryProps {
  children: ReactNode;
}

interface DashboardErrorBoundaryState {
  hasError: boolean;
}

export class DashboardErrorBoundary extends Component<DashboardErrorBoundaryProps, DashboardErrorBoundaryState> {
  public state: DashboardErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): DashboardErrorBoundaryState {
    return { hasError: true };
  }

  public render() {
    if (!this.state.hasError) return this.props.children;
    return <main className="error-screen"><AlertTriangle size={28} /><h1>{UI_COPY.errorTitle}</h1><p>{UI_COPY.errorDescription}</p><button className="primary-button" onClick={() => window.location.reload()}><RotateCw size={16} />{UI_COPY.retry}</button></main>;
  }
}
