import { expect, test } from '@playwright/test';
import type { Account } from '../src/api.js';
import { db } from '../src/db.js';
import {
  createAdmin,
  createApprovedAssistant,
  createCustomer,
  postRequest,
  type Assistant,
  type Catalog,
} from '../src/fixtures.js';
import { getCatalog } from '../src/state.js';
import { loginViaUi } from '../src/ui.js';

test.describe('assistant journey: open requests → quote → withdraw', () => {
  let catalog: Catalog;
  let customer: Account;
  let ada: Assistant;

  test.beforeAll(async () => {
    catalog = getCatalog();
    const admin = await createAdmin();
    customer = await createCustomer('Ngozi Private-Customer');
    ada = await createApprovedAssistant(admin, {
      displayName: 'Ada Quotes',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
  });

  test('an assistant finds a matching request, quotes, sees it in My quotes, and withdraws', async ({
    page,
  }) => {
    const requestId = await postRequest(customer, catalog);
    await loginViaUi(page, ada.account);

    // Discovery: the request is in the feed and the customer is anonymous to the assistant.
    await page.goto('/assistant/requests');
    await expect(page.getByRole('heading', { name: 'Open requests' })).toBeVisible();
    const row = page.locator(`a[href="/assistant/requests/${requestId}"]`);
    await expect(row).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Ngozi');
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: catalog.hold.name })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(customer.email);

    // Client-side validation of the quote form.
    await page.getByLabel('Your price (₦)').fill('10');
    await page.getByRole('button', { name: 'Send quote' }).click();
    await expect(page.getByRole('heading', { name: 'Your quote' })).toHaveCount(0);
    await page.getByLabel('Your price (₦)').fill('5,000');
    await page.getByLabel(/Message/).fill('Call me on 08031234567 and I will come.');
    await page.getByRole('button', { name: 'Send quote' }).click();
    await expect(page.getByRole('heading', { name: 'Your quote' })).toHaveCount(0);
    expect(
      (
        await db().query('SELECT count(*)::int AS n FROM quotes WHERE "requestId" = $1', [
          requestId,
        ])
      ).rows[0].n,
    ).toBe(0);

    // A valid quote.
    await page.getByLabel(/Message/).fill('I can be there from 7am and stay until you arrive.');
    await page.getByRole('button', { name: 'Send quote' }).click();
    await expect(page.getByRole('heading', { name: 'Your quote' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw quote' })).toBeVisible();

    await page.goto('/assistant/quotes');
    const mine = page.locator('li', { hasText: catalog.hold.name }).first();
    await expect(mine).toContainText('5,000');
    await expect(mine).toContainText('Waiting for the customer to decide');

    // Withdraw: the quote closes and the request is open for quotes again.
    await page.goto(`/assistant/requests/${requestId}`);
    await page.getByRole('button', { name: 'Withdraw quote' }).click();
    await expect(page.getByText('You withdrew this quote')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send quote' })).toBeVisible();
    const state = await db().query(
      `SELECT q.status AS quote, r.status AS request FROM quotes q JOIN service_requests r ON r.id = q."requestId"
       WHERE r.id = $1`,
      [requestId],
    );
    expect(state.rows).toEqual([{ quote: 'WITHDRAWN', request: 'OPEN' }]);

    // After a withdrawal the same assistant may quote again.
    await page.getByLabel('Your price (₦)').fill('5500');
    await page.getByRole('button', { name: 'Send quote' }).click();
    await expect(page.getByRole('heading', { name: 'Your quote' })).toBeVisible();
    const after = await db().query(
      'SELECT status FROM quotes WHERE "requestId" = $1 ORDER BY "createdAt"',
      [requestId],
    );
    expect(after.rows.map((r) => r.status)).toEqual(['WITHDRAWN', 'PENDING']);
  });
});
