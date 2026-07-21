import { z } from "zod";

import { OFFICE_COPY } from "./copy";
import type { OfficeRequestInput } from "./types";

export const officeRequestSchema = z.object({
  request: z
    .string()
    .trim()
    .min(8, OFFICE_COPY.composer.minError)
    .max(2_000, OFFICE_COPY.composer.maxError),
}) satisfies z.ZodType<OfficeRequestInput>;
