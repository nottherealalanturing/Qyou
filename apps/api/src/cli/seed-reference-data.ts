import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { SeedService } from '../seed/seed.service.js';

/**
 * Loads launch reference data (cities, categories, eligible tasks). Safe to run repeatedly:
 * it only inserts what is missing and never modifies existing records. It seeds NO locations.
 *
 *   pnpm --filter @qyou/api db:seed
 */
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
let exitCode = 1;
try {
  const report = await app.get(SeedService).seedReferenceData();
  console.log(
    `Reference data: ${report.citiesCreated} cities, ${report.categoriesCreated} categories and ` +
      `${report.tasksCreated} tasks created` +
      (report.citiesCreated + report.categoriesCreated + report.tasksCreated === 0
        ? ' (already up to date; nothing changed).'
        : '.'),
  );
  exitCode = 0;
} catch (error) {
  console.error(`Seeding failed: ${error instanceof Error ? error.message : 'unknown error'}`);
} finally {
  await app.close();
}
process.exit(exitCode);
