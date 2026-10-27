import { expect, type BrowserContext, type Browser, type Page } from '@playwright/test';
import type { Account } from './api.js';
import { resetRateLimits } from './db.js';
import { WEB_URL } from './env.js';

/** Logs in through the real login form (no cookie injection, no bypass) and waits for the redirect. */
export async function loginViaUi(page: Page, account: Account, next?: string): Promise<void> {
  await resetRateLimits();
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A fresh, isolated browser context (own cookies) already signed in as `account`. */
export async function signedInPage(
  browser: Browser,
  account: Account,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    baseURL: WEB_URL,
    locale: 'en-GB',
    timezoneId: 'Africa/Lagos',
    ...(options.viewport ? { viewport: options.viewport } : {}),
  });
  const page = await context.newPage();
  await loginViaUi(page, account);
  return { page, context };
}

/** True when the page scrolls sideways: the symptom of the header overflow found at 375px in M1.5. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/** Same-origin API call through the web proxy with the page's own cookies and the allowed Origin. */
export async function apiThroughWeb(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
) {
  const res = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { origin: WEB_URL, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { data }),
  });
  const text = await res.text();
  return { status: res.status(), text, json: text ? JSON.parse(text) : null };
}
