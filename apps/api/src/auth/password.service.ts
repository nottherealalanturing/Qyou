import { Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** OWASP-recommended Argon2id minimum: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = {
  // `Algorithm` is an ambient const enum (unusable under isolatedModules); 2 === Argon2id.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /** Returns false (never throws) for a wrong password or a malformed stored hash. */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same CPU/memory as a real verification. Call it when the account does not exist so
   * response time does not reveal which emails are registered.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('qyou-timing-equalisation-placeholder');
    await this.verify(await this.dummyHash, password);
  }
}
