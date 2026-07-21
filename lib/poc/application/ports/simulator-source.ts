export interface SimulatorSourceContext {
  sourceId: string;
  displayName: string;
  workingDirectory: string;
  outputSchemaPath: string;
  policyNotice: string;
  snapshot: string;
  snapshotDigest: string;
}

export interface SimulatorSource {
  readonly id: string;
  resolve(): Promise<SimulatorSourceContext>;
}
