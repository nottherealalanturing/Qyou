import { BadRequestException } from '@nestjs/common';

export interface FieldIssue {
  path: string;
  message: string;
}

/** Same shape the global ZodValidationPipe produces, for rules that need database/merged state. */
export function validationFailed(issues: FieldIssue[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    issues,
  });
}
