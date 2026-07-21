import { z } from "zod";

import { UI_COPY } from "./copy";

export const newTaskSchema = z.object({
  title: z.string().trim().min(2, UI_COPY.formRequired).max(80),
  brief: z.string().trim().min(10, UI_COPY.formRequired).max(500),
  priority: z.enum(["urgent", "high", "normal"]),
  assigneeId: z.enum(["orbit", "probe", "calc", "verify", "gitmate", "flashx"]),
  requiredOutput: z.string().trim().min(2, UI_COPY.formRequired).max(120),
});
