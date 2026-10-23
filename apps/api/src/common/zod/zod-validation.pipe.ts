import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { hasZodSchema } from './create-zod-dto.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Global pipe: every `@Body()`/`@Query()`/`@Param()` typed with a `createZodDto` class is parsed
 * and replaced by the validated (stripped/normalised) value. Error responses list the failing
 * paths and messages but never echo the submitted values.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { metatype } = metadata;
    if (!metatype || !hasZodSchema(metatype)) return value;

    const result = metatype.schema.safeParse(value ?? {});
    if (result.success) return result.data;

    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      issues,
    });
  }
}
