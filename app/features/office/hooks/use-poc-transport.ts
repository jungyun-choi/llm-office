"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
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

  const startProbe = useCallback((): Promise<PocEndpoint> => {
    probeControllerRef.current?.abort();
    const controller = new AbortController();
    probeControllerRef.current = controller;
    endpointRef.current = undefined;
    const probe = probePocEndpoint(controller.signal);
    probePromiseRef.current = probe;
    void probe.then(
      (endpoint) => {
        if (probeControllerRef.current !== controller) return;
        endpointRef.current = endpoint;
        setConnectionMode(endpoint.connectionMode);
      },
      () => {
        if (probeControllerRef.current !== controller || controller.signal.aborted) return;
        setConnectionMode("disconnected");
      },
    ).finally(() => {
      if (probeControllerRef.current !== controller) return;
      probeControllerRef.current = undefined;
      if (probePromiseRef.current === probe) probePromiseRef.current = undefined;
    });
    return probe;
  }, []);

  const retryConnection = useCallback(() => {
    setConnectionMode("checking");
    void startProbe();
  }, [startProbe]);

  useEffect(() => {
    void startProbe();
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
    setConnectionMode("checking");
    return startProbe();
  }, [startProbe]);

  return { connectionMode, resolveEndpoint, retryConnection };
}
