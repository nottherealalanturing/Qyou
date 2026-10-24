import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SmsService } from './sms.service.js';

/**
 * The production default while no SMS provider has been selected and configured. It never pretends
 * to deliver: callers see `isAvailable() === false` and answer 503 without creating a code.
 */
@Injectable()
export class UnconfiguredSmsService extends SmsService {
  readonly transport = 'none';

  isAvailable(): boolean {
    return false;
  }

  async send(): Promise<void> {
    throw new ServiceUnavailableException('Phone verification is not available yet');
  }
}
