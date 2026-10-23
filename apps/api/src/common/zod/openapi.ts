import { z } from 'zod';
import type { createZodDto } from './create-zod-dto.js';

type ZodDtoClass = ReturnType<typeof createZodDto>;

/** OpenAPI request-body schema derived from the same zod schema the server validates with. */
export function zodBodySchema(dto: ZodDtoClass): { schema: Record<string, unknown> } {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(dto.schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return { schema };
}
