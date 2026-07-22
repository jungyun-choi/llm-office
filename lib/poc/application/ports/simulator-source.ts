export interface SimulatorSourceContext {
  sourceId: string;
  displayName: string;
  workingDirectory: string;
  outputSchemaPath: string;
  policyNotice: string;
  snapshot: string;
  snapshotDigest: string;
}

export interface SimulatorSourceRequest {
  featureRequest: string;
  signal?: AbortSignal;
}

export interface SimulatorSource {
  readonly id: string;
  resolve(request?: SimulatorSourceRequest): Promise<SimulatorSourceContext>;
}
