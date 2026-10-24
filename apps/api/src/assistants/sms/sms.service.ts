/**
 * Transport boundary for one-time codes by SMS. Implementations must NOT log message bodies.
 *
 * No real provider is configured or integrated (DECISIONS D-038). The two implementations below are
 * honest about that: one simulates delivery for local development, the other refuses.
 */
export abstract class SmsService {
  /** False when nothing can actually deliver messages. Callers must check BEFORE creating a code. */
  abstract isAvailable(): boolean;
  /** Human-readable transport name for audit/ops ("simulated-dev", "none"). */
  abstract readonly transport: string;
  abstract send(toE164: string, text: string): Promise<void>;
}
