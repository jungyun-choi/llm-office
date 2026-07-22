import type { PocRunResult } from "../domain/poc-types";
import { PocRunnerError } from "../domain/poc-errors";
import {
  hasTrustedCompanyExtension,
  importTrustedCompanyExtension,
} from "./trusted-extension-module";

const ISSUE_EXTENSION = {
  modulePathEnvironment: "AI_OFFICE_ISSUE_PUBLISHER_MODULE",
  moduleDigestEnvironment: "AI_OFFICE_ISSUE_PUBLISHER_MODULE_SHA256",
} as const;
const ISSUE_CONTRACT_VERSION = "ai-office-company-issue-v1";

export interface IssuePublishContext {
  artifactDigest: string;
  idempotencyKey: string;
}

export interface IssuePublisher {
  publish(
    output: PocRunResult,
    context: IssuePublishContext,
  ): Promise<{ issueUrl: string }>;
}

type IssuePublisherFactory = () => IssuePublisher | Promise<IssuePublisher>;

/**
 * Loads and validates the trusted publisher adapter only. Publication stays
 * disabled until the Job API has a digest-bound human approval action and a
 * reconciliation contract.
 */
export async function loadExtensionIssuePublisher(): Promise<IssuePublisher> {
  try {
    const imported = await importTrustedCompanyExtension(ISSUE_EXTENSION);
    if (imported.contractVersion !== ISSUE_CONTRACT_VERSION) {
      throw new PocRunnerError("unavailable");
    }
    const factory = imported.createIssuePublisher;
    if (typeof factory !== "function") throw new PocRunnerError("unavailable");
    const publisher = await (factory as IssuePublisherFactory)();
    if (!isIssuePublisher(publisher)) throw new PocRunnerError("unavailable");
    return publisher;
  } catch (error) {
    if (error instanceof PocRunnerError) throw error;
    throw new PocRunnerError("unavailable");
  }
}

export function hasConfiguredIssuePublisher(): Promise<boolean> {
  return hasTrustedCompanyExtension(ISSUE_EXTENSION);
}

function isIssuePublisher(value: unknown): value is IssuePublisher {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof (value as Partial<IssuePublisher>).publish === "function";
}
