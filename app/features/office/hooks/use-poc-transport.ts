"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  PocClientError,
  probePocEndpoint,
  type PocConnectionMode,
  type PocEndpoint,
} from "../api/poc-client";

export interface PocTransportState {
  connectionMode: PocConnectionMode;
  resolveEndpoint: () => Promise<PocEndpoint>;
  retryConnection: () => void;
}

export function usePocTransport(): PocTransportState {
  const [connectionMode, setConnectionMode] = useState<PocConnectionMode>("checking");
  const endpointRef = useRef<PocEndpoint | undefined>(undefined);
  const probePromiseRef = useRef<Promise<PocEndpoint> | undefined>(undefined);
  const probeControllerRef = useRef<AbortController | undefined>(undefined);
  const probeErrorRef = useRef<PocClientError | undefined>(undefined);

  const startProbe = useCallback(() => {
    probeControllerRef.current?.abort();
    const controller = new AbortController();
    probeControllerRef.current = controller;
    endpointRef.current = undefined;
    probeErrorRef.current = undefined;
    const probe = probePocEndpoint(controller.signal);
    probePromiseRef.current = probe;
    void probe.then(
      (endpoint) => {
        if (probeControllerRef.current !== controller) return;
        endpointRef.current = endpoint;
        setConnectionMode(endpoint.connectionMode);
      },
      (error: unknown) => {
        if (probeControllerRef.current !== controller || controller.signal.aborted) return;
        probeErrorRef.current = error instanceof PocClientError
          ? error
          : new PocClientError(
            "CAPABILITIES_UNAVAILABLE",
            "POC 실행 환경을 확인하지 못했습니다. Zen 연결을 다시 확인해 주세요.",
          );
        setConnectionMode("disconnected");
      },
    ).finally(() => {
      if (probeControllerRef.current !== controller) return;
      probeControllerRef.current = undefined;
      if (probePromiseRef.current === probe) probePromiseRef.current = undefined;
    });
  }, []);

  const retryConnection = useCallback(() => {
    setConnectionMode("checking");
    startProbe();
  }, [startProbe]);

  useEffect(() => {
    startProbe();
    return () => {
      probeControllerRef.current?.abort();
      probeControllerRef.current = undefined;
      probePromiseRef.current = undefined;
    };
  }, [startProbe]);

  const resolveEndpoint = useCallback(async (): Promise<PocEndpoint> => {
    const probe = probePromiseRef.current;
    if (probe) return probe;
    const endpoint = endpointRef.current;
    if (endpoint) return endpoint;
    const probeError = probeErrorRef.current;
    if (probeError) throw probeError;
    throw new PocClientError("CAPABILITIES_NOT_READY", "POC 실행 환경을 확인하는 중입니다.");
  }, []);

  return { connectionMode, resolveEndpoint, retryConnection };
}
