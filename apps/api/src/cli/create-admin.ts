import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AdminBootstrapService } from '../admin/admin-bootstrap.service.js';
import { AppModule } from '../app.module.js';

/**
 * One-time administrator bootstrap. Usage (see docs/RUNBOOK.md):
 *
 *   pnpm --filter @qyou/api admin:create --email you@company.com --name "Your Name" --yes
 *
 * Without --yes it only prints what it would do (dry run). It never accepts or prints a password.
 * Exit codes: 0 created · 1 refused/failed · 2 not confirmed (dry run) · 64 bad usage.
 */
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    yes: { type: 'boolean', default: false },
    additional: { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.email || !values.name) {
  console.error(
    'Usage: admin:create --email <address> --name "<full name>" [--yes] [--additional]',
  );
  process.exit(64);
}

if (!values.yes) {
  console.log(
    `Dry run. Would create ADMINISTRATOR "${values.name}" <${values.email}> and email a one-time ` +
      'set-password link to that address.\nRe-run with --yes to proceed.',
  );
  process.exit(2);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
let exitCode = 1;
try {
  const result = await app.get(AdminBootstrapService).bootstrap({
    email: values.email,
    name: values.name,
    allowAdditional: values.additional === true,
  });

  switch (result.status) {
    case 'created':
      console.log(`Administrator created (id ${result.userId}).`);
      console.log(
        result.emailSent
          ? 'A one-time set-password link was emailed to them (valid 24 hours).'
          : 'WARNING: the email could not be sent. Ask them to use "Forgot password" on the login page.',
      );
      exitCode = 0;
      break;
    case 'refused':
      console.error(
        result.reason === 'admin_exists'
          ? 'Refused: an administrator already exists. Nothing was changed. (Use --additional to add another.)'
          : 'Refused: an account with that email already exists. Nothing was changed. Existing accounts are never promoted.',
      );
      break;
    case 'invalid':
      console.error(`Invalid input:\n  ${result.problems.join('\n  ')}`);
      break;
  }
} finally {
  await app.close();
}
process.exit(exitCode);
