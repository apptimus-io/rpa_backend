import { z } from "zod";

export const idParamSchema = z.object({
  id: z.string().min(1).max(64)
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

const dateRangeShape = {
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional()
};

export const dateRangeQuerySchema = z.object(dateRangeShape).refine((value) => {
  if (!value.dateFrom || !value.dateTo) return true;
  return new Date(value.dateFrom) <= new Date(value.dateTo);
}, "dateFrom must be before or equal to dateTo");

export function withDateRange<T extends z.ZodRawShape>(shape: T) {
  return z.object({
    ...shape,
    ...dateRangeShape
  }).refine((value) => {
    if (!value.dateFrom || !value.dateTo) return true;
    return new Date(value.dateFrom) <= new Date(value.dateTo);
  }, "dateFrom must be before or equal to dateTo");
}
