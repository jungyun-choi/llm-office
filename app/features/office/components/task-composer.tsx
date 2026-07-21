"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUp, LoaderCircle } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useForm } from "react-hook-form";

import { OFFICE_COPY } from "../copy";
import { officeRequestSchema } from "../office-request-schema";
import type { OfficeRequestInput } from "../types";

interface TaskComposerProps {
  isRunning: boolean;
  onRequest: (input: OfficeRequestInput) => boolean;
}

export function TaskComposer({ isRunning, onRequest }: TaskComposerProps) {
  const form = useForm<OfficeRequestInput>({
    resolver: zodResolver(officeRequestSchema),
    defaultValues: { request: "" },
  });

  const submitRequest = form.handleSubmit((input) => {
    if (onRequest(input)) form.reset();
  });

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    void submitRequest();
  }

  const error = form.formState.errors.request;

  return (
    <form className="task-composer" onSubmit={submitRequest} noValidate>
      <div className="task-composer__heading">
        <div>
          <span>{OFFICE_COPY.hero.eyebrow}</span>
          <label htmlFor="office-request">{OFFICE_COPY.composer.label}</label>
        </div>
        <small>{OFFICE_COPY.composer.shortcut}</small>
      </div>
      <div className={`task-composer__field ${error ? "has-error" : ""}`}>
        <textarea
          id="office-request"
          maxLength={2_000}
          rows={2}
          placeholder={OFFICE_COPY.composer.placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "office-request-error" : "office-request-hint"}
          disabled={isRunning}
          onKeyDown={handleComposerKeyDown}
          {...form.register("request")}
        />
        <button type="submit" disabled={isRunning}>
          {isRunning ? (
            <LoaderCircle className="is-spinning" size={18} aria-hidden="true" />
          ) : (
            <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
          )}
          <span>{isRunning ? OFFICE_COPY.composer.running : OFFICE_COPY.composer.submit}</span>
        </button>
      </div>
      {error ? (
        <p className="task-composer__error" id="office-request-error" role="alert">
          {error.message}
        </p>
      ) : (
        <p className="task-composer__hint" id="office-request-hint">
          {OFFICE_COPY.composer.hint}
        </p>
      )}
    </form>
  );
}
