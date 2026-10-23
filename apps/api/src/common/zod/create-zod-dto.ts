import type { z } from 'zod';

/**
 * Turns a zod schema into a class usable as a Nest `@Body()`/`@Query()` type. The class carries
 * the schema statically so the global `ZodValidationPipe` can validate any parameter typed with it.
 */
export function createZodDto<TSchema extends z.ZodType>(schema: TSchema) {
  abstract class ZodDto {
    static readonly schema = schema;
  }
  return ZodDto as unknown as (abstract new () => z.output<TSchema>) & { readonly schema: TSchema };
}

export function hasZodSchema(value: unknown): value is { schema: z.ZodType } {
  return (
    typeof value === 'function' &&
    'schema' in value &&
    typeof (value as { schema?: { safeParse?: unknown } }).schema?.safeParse === 'function'
  );
}
