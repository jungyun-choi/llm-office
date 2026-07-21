"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus, X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { PRIORITY_LABELS, UI_COPY } from "../copy";
import { newTaskSchema } from "../new-task-schema";
import type { Agent, NewTaskInput, TaskPriority } from "../types";

interface NewTaskModalProps {
  agents: Agent[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: NewTaskInput) => void;
}

const PRIORITIES: TaskPriority[] = ["urgent", "high", "normal"];

export function NewTaskModal({ agents, isOpen, onClose, onSubmit }: NewTaskModalProps) {
  const form = useForm<NewTaskInput>({ resolver: zodResolver(newTaskSchema), defaultValues: { title: "", brief: "", priority: "high", assigneeId: "orbit", requiredOutput: "" } });
  useModalLifecycle(isOpen, onClose, form.reset);
  if (!isOpen) return null;
  return (
    <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label={UI_COPY.close} /><section className="new-task-modal" role="dialog" aria-modal="true" aria-labelledby="new-task-title"><header><div><span>NEW REQUEST</span><h2 id="new-task-title">{UI_COPY.createTitle}</h2><p>{UI_COPY.createDescription}</p></div><button className="icon-button" onClick={onClose} aria-label={UI_COPY.close}><X size={19} /></button></header><form onSubmit={form.handleSubmit(onSubmit)}><FormField label={UI_COPY.taskName} error={form.formState.errors.title?.message} errorId="task-title-error"><input {...form.register("title")} placeholder={UI_COPY.taskNamePlaceholder} aria-invalid={Boolean(form.formState.errors.title)} aria-describedby={form.formState.errors.title ? "task-title-error" : undefined} autoFocus /></FormField><FormField label={UI_COPY.taskBrief} error={form.formState.errors.brief?.message} errorId="task-brief-error"><textarea {...form.register("brief")} placeholder={UI_COPY.taskBriefPlaceholder} aria-invalid={Boolean(form.formState.errors.brief)} aria-describedby={form.formState.errors.brief ? "task-brief-error" : undefined} rows={4} /></FormField><div className="form-grid"><FormField label={UI_COPY.priority} error={form.formState.errors.priority?.message} errorId="task-priority-error"><select {...form.register("priority")} aria-invalid={Boolean(form.formState.errors.priority)} aria-describedby={form.formState.errors.priority ? "task-priority-error" : undefined}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}</select></FormField><FormField label={UI_COPY.agent} error={form.formState.errors.assigneeId?.message} errorId="task-agent-error"><select {...form.register("assigneeId")} aria-invalid={Boolean(form.formState.errors.assigneeId)} aria-describedby={form.formState.errors.assigneeId ? "task-agent-error" : undefined}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select></FormField></div><FormField label={UI_COPY.output} error={form.formState.errors.requiredOutput?.message} errorId="task-output-error"><input {...form.register("requiredOutput")} placeholder={UI_COPY.outputPlaceholder} aria-invalid={Boolean(form.formState.errors.requiredOutput)} aria-describedby={form.formState.errors.requiredOutput ? "task-output-error" : undefined} /></FormField><footer><button type="button" className="secondary-button" onClick={onClose}>{UI_COPY.cancel}</button><button type="submit" className="primary-button"><Plus size={16} />{UI_COPY.create}</button></footer></form></section></div>
  );
}

function FormField({ label, error, errorId, children }: { label: string; error?: string; errorId: string; children: React.ReactNode }) {
  return <label className={`form-field ${error ? "has-error" : ""}`}><span>{label}</span>{children}{error && <small id={errorId} role="alert"><AlertCircle size={12} />{error}</small>}</label>;
}

function useModalLifecycle(isOpen: boolean, onClose: () => void, reset: () => void) {
  useEffect(() => { if (!isOpen) return; reset(); const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.body.classList.add("is-modal-open"); document.addEventListener("keydown", handleKey); return () => { document.body.classList.remove("is-modal-open"); document.removeEventListener("keydown", handleKey); }; }, [isOpen, onClose, reset]);
}
