import { expect, test } from '@playwright/test';
import { db } from '../src/db.js';
import {
  createApprovedAssistant,
  createAdmin,
  createCustomer,
  type Assistant,
  type Catalog,
} from '../src/fixtures.js';
import type { Account } from '../src/api.js';
import { getCatalog } from '../src/state.js';
import { loginViaUi, signedInPage } from '../src/ui.js';

test.describe('customer journey: discover → request → quotes → select', () => {
  let catalog: Catalog;
  let customer: Account;
  let ada: Assistant;
  let bola: Assistant;
  let carl: Assistant;

  test.beforeAll(async () => {
    catalog = getCatalog();
    const admin = await createAdmin();
    customer = await createCustomer('Chidi Customer');
    const lagos = [catalog.cityA.id];
    ada = await createApprovedAssistant(admin, {
      displayName: 'Ada Okafor',
      cityIds: lagos,
      taskIds: [catalog.hold.id, catalog.docs.id],
    });
    bola = await createApprovedAssistant(admin, {
      displayName: 'Bola Adeyemi',
      cityIds: lagos,
      taskIds: [catalog.hold.id],
    });
    // Serves a different city: must not appear in a City A search, nor see the request.
    carl = await createApprovedAssistant(admin, {
      displayName: 'Carl Eze',
      cityIds: [catalog.cityB.id],
      taskIds: [catalog.hold.id],
    });
    // Only a draft application: not eligible, so never listed.
    await createApprovedAssistant(admin, {
      displayName: 'Dora Nwosu',
      cityIds: lagos,
      taskIds: [catalog.hold.id],
      stopAt: 'DRAFT',
    });
  });

  test('a customer finds eligible assistants, posts a request, compares quotes and accepts one', async ({
    page,
    browser,
  }) => {
    await loginViaUi(page, customer);

    // ── discovery: filter by city and task ──────────────────────────────────────────────────────
    await page.goto('/assistants');
    await expect(page.getByRole('heading', { name: 'Find an assistant' })).toBeVisible();
    await expect(page.getByText('Ada Okafor')).toBeVisible();
    await expect(page.getByText('Carl Eze')).toBeVisible(); // unfiltered: every eligible assistant
    await expect(page.getByText('Dora Nwosu')).toHaveCount(0); // a draft is never public

    const filters = page.locator('form[aria-label="Filter assistants"]');
    await filters.getByLabel('City').selectOption({ label: catalog.cityA.name });
    await filters.getByLabel('What do you need?').selectOption({ label: catalog.hold.name });
    await filters.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/city=/);
    await expect(page.getByText('Ada Okafor')).toBeVisible();
    await expect(page.getByText('Bola Adeyemi')).toBeVisible();
    await expect(page.getByText('Carl Eze')).toHaveCount(0);
    await expect(page.getByText('Dora Nwosu')).toHaveCount(0);

    // ── from a profile to a prefilled request form ──────────────────────────────────────────────
    await page
      .getByRole('link', { name: /Ada Okafor/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ada Okafor' })).toBeVisible();
    await page
      .locator('li', { hasText: catalog.hold.name })
      .getByRole('link', { name: /Post a request/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Post a request' })).toBeVisible();
    await expect(page.locator('#task')).toHaveValue(catalog.hold.id);

    // The form refuses contact details and stores nothing.
    await page.getByLabel('Describe the job').fill('Call me on 08031234567 when you are there.');
    await page.getByRole('button', { name: 'Post request' }).click();
    await expect(page.getByText(/phone number|contact/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/requests\/new/);

    await page
      .getByLabel('Describe the job')
      .fill('Please hold my place in the morning line at the Ikeja branch until I arrive.');
    await page.getByRole('button', { name: 'Post request' }).click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
    const requestId = page.url().split('/').at(-1)!;
    await expect(page.getByRole('heading', { level: 1, name: catalog.hold.name })).toBeVisible();
    await expect(page.getByText(/No quotes yet/)).toBeVisible();

    // ── two assistants quote (their own isolated browser sessions) ──────────────────────────────
    const adaSession = await signedInPage(browser, ada.account);
    await adaSession.page.goto('/assistant/requests');
    await adaSession.page
      .getByRole('link', { name: new RegExp(catalog.hold.name) })
      .first()
      .click();
    await adaSession.page.getByLabel('Your price (₦)').fill('7,500.50');
    await adaSession.page
      .getByLabel(/Message/)
      .fill('I can be there from 7am and stay until you arrive.');
    await adaSession.page.getByRole('button', { name: 'Send quote' }).click();
    await expect(adaSession.page.getByRole('heading', { name: 'Your quote' })).toBeVisible();

    const bolaSession = await signedInPage(browser, bola.account);
    await bolaSession.page.goto(`/assistant/requests/${requestId}`);
    await bolaSession.page.getByLabel('Your price (₦)').fill('6000');
    await bolaSession.page.getByRole('button', { name: 'Send quote' }).click();
    await expect(bolaSession.page.getByRole('heading', { name: 'Your quote' })).toBeVisible();

    // The assistant who serves another city sees nothing.
    const carlSession = await signedInPage(browser, carl.account);
    const carlResponse = await carlSession.page.goto(`/assistant/requests/${requestId}`);
    expect(carlResponse?.status()).toBe(404);
    await carlSession.context.close();

    // ── the customer compares quotes (cheapest first) and accepts one ───────────────────────────
    await page.goto(`/requests/${requestId}`);
    const quotes = page.locator('section[aria-labelledby="quotes-heading"] li');
    await expect(quotes).toHaveCount(2);
    await expect(quotes.nth(0)).toContainText('6,000');
    await expect(quotes.nth(0)).toContainText('Bola Adeyemi');
    await expect(quotes.nth(1)).toContainText('7,500.50');

    await quotes
      .nth(0)
      .getByRole('button', { name: /Accept this quote/ })
      .click();
    await expect(quotes.nth(0)).toContainText('Nothing is charged');
    await quotes.nth(0).getByRole('button', { name: 'Yes, accept' }).click();

    await expect(page.getByRole('heading', { name: 'Accepted quote' })).toBeVisible();
    await expect(page.getByText('Not selected').first()).toBeVisible();

    // ── persisted state, not just pixels ────────────────────────────────────────────────────────
    const { rows } = await db().query(
      `SELECT q.status, p."displayName" FROM quotes q JOIN assistant_profiles p ON p.id = q."assistantId"
       WHERE q."requestId" = $1 ORDER BY q."amountKobo"`,
      [requestId],
    );
    expect(rows).toEqual([
      { status: 'ACCEPTED', displayName: 'Bola Adeyemi' },
      { status: 'NOT_SELECTED', displayName: 'Ada Okafor' },
    ]);
    const request = await db().query('SELECT status FROM service_requests WHERE id = $1', [
      requestId,
    ]);
    expect(request.rows[0].status).toBe('QUOTE_ACCEPTED');

    // The losing assistant sees an honest status in their own session.
    await adaSession.page.goto('/assistant/quotes');
    await expect(adaSession.page.getByText('The customer chose a different quote')).toBeVisible();
    await adaSession.context.close();
    await bolaSession.context.close();
  });
});
