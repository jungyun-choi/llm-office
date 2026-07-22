"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUp, Info, ListPlus } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useForm } from "react-hook-form";

import type { PocConnectionMode } from "../api/poc-client";
import { OFFICE_COPY } from "../copy";
import { officeRequestSchema } from "../office-request-schema";
import type { OfficeConnectionMode, OfficeRequestInput } from "../types";

type ComposerConnectionMode = OfficeConnectionMode | PocConnectionMode;

interface TaskComposerProps {
  isRunning: boolean;
  isSubmitting: boolean;
  connectionMode: ComposerConnectionMode;
  queueErrorMessage: string | null;
  onRequest: (input: OfficeRequestInput) => Promise<boolean>;
}

export function TaskComposer({ isRunning, isSubmitting, connectionMode, queueErrorMessage, onRequest }: TaskComposerProps) {
  const form = useForm<OfficeRequestInput>({
    resolver: zodResolver(officeRequestSchema),
    defaultValues: { request: "" },
  });

  const submitRequest = form.handleSubmit(async (input) => {
    if (await onRequest(input)) form.reset();
  });

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    void submitRequest();
  }

  const error = form.formState.errors.request;
  const errorMessage = error?.message ?? queueErrorMessage;

  return (
    <form className="task-composer" onSubmit={submitRequest} noValidate>
      <div className="task-composer__heading">
        <div>
          <span>{OFFICE_COPY.hero.eyebrow}</span>
          <label htmlFor="office-request">{OFFICE_COPY.composer.label}</label>
        </div>
        <small>{OFFICE_COPY.composer.shortcut}</small>
      </div>
      <p className="poc-truth-note">
        <Info size={14} aria-hidden="true" />
        <span>{getPocTruthLabel(connectionMode)}</span>
      </p>
      <div className={`task-composer__field ${errorMessage ? "has-error" : ""}`}>
        <textarea
          id="office-request"
          maxLength={2_000}
          rows={2}
          placeholder={OFFICE_COPY.composer.placeholder}
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? "office-request-error" : "office-request-hint"}
          onKeyDown={handleComposerKeyDown}
          {...form.register("request")}
        />
        <button type="submit" disabled={isSubmitting}>
          {isRunning ? (
            <ListPlus size={18} aria-hidden="true" />
          ) : (
            <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
          )}
          <span>{isRunning ? OFFICE_COPY.composer.enqueue : OFFICE_COPY.composer.submit}</span>
        </button>
      </div>
      {errorMessage ? (
        <p className="task-composer__error" id="office-request-error" role="alert">
          {errorMessage}
        </p>
      ) : (
        <p className="task-composer__hint" id="office-request-hint">
          {OFFICE_COPY.composer.hint}
        </p>
      )}
    </form>
  );
}

export function getPocTruthLabel(connectionMode: ComposerConnectionMode): string {
  return OFFICE_COPY.composer.pocTruth[connectionMode];
}
