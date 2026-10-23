import { z } from 'zod';
import { createZodDto } from '../common/zod/create-zod-dto.js';

/** Roles an administrator may assign over HTTP. ADMIN is deliberately absent (see D-024). */
export const ASSIGNABLE_ROLES = ['CUSTOMER', 'ASSISTANT', 'BUSINESS_STAFF'] as const;

export const assignRoleSchema = z.strictObject({ role: z.enum(ASSIGNABLE_ROLES) });

export class AssignRoleDto extends createZodDto(assignRoleSchema) {}
