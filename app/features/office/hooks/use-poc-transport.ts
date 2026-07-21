"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  hostedPocEndpoint,
  probeLocalPocEndpoint,
  type PocConnectionMode,
  type PocEndpoint,
} from "../api/poc-client";

const LOCAL_PROBE_TIMEOUT_MS = 900;

export interface PocTransportState {
  connectionMode: PocConnectionMode;
  resolveEndpoint: () => Promise<PocEndpoint>;
  markHostedFallback: () => void;
}

export function usePocTransport(): PocTransportState {
  const [connectionMode, setConnectionMode] = useState<PocConnectionMode>("checking");
  const endpointRef = useRef<PocEndpoint>(hostedPocEndpoint());
  const probePromiseRef = useRef<Promise<PocEndpoint> | undefined>(undefined);

  useEffect(() => {
    if (!shouldProbeLocalBridge()) {
      let active = true;
      const hosted = hostedPocEndpoint();
      const probe = Promise.resolve(hosted);
      probePromiseRef.current = probe;
      void probe.then((endpoint) => {
        if (!active) return;
        endpointRef.current = endpoint;
        setConnectionMode(endpoint.connectionMode);
      });
      return () => {
        active = false;
        if (probePromiseRef.current === probe) probePromiseRef.current = undefined;
      };
    }
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);
    const probe = probeLocalPocEndpoint(controller.signal).catch(() => hostedPocEndpoint());
    probePromiseRef.current = probe;
    void probe.then((endpoint) => {
      if (!active) return;
      endpointRef.current = endpoint;
      setConnectionMode(endpoint.connectionMode);
    }).finally(() => window.clearTimeout(timeoutId));
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
      if (probePromiseRef.current === probe) probePromiseRef.current = undefined;
    };
  }, []);

  const resolveEndpoint = useCallback(async (): Promise<PocEndpoint> => {
    return probePromiseRef.current ?? endpointRef.current;
  }, []);

  const markHostedFallback = useCallback(() => {
    const endpoint = hostedPocEndpoint();
    endpointRef.current = endpoint;
    probePromiseRef.current = Promise.resolve(endpoint);
    setConnectionMode("demo");
  }, []);

  return { connectionMode, resolveEndpoint, markHostedFallback };
}

function shouldProbeLocalBridge(): boolean {
  if (typeof window === "undefined") return false;
  const isLoopback = window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  return isLoopback && window.location.protocol === "http:";
}
