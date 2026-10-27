import { expect, test } from '@playwright/test';
import type { Account } from '../src/api.js';
import { call } from '../src/api.js';
import {
  createAdmin,
  createApprovedAssistant,
  createCustomer,
  postQuote,
  postRequest,
  type Assistant,
  type Catalog,
} from '../src/fixtures.js';
import { getCatalog } from '../src/state.js';
import { apiThroughWeb, loginViaUi } from '../src/ui.js';

const SECRET_JOB = 'Zebra-crossing token 7731 for the Ikeja branch queue please.';

test.describe('privacy boundaries', () => {
  let catalog: Catalog;
  let admin: Account;
  let customer: Account;
  let ada: Assistant;
  let bola: Assistant;
  let requestId: string;

  test.beforeAll(async () => {
    catalog = getCatalog();
    admin = await createAdmin();
    customer = await createCustomer('Hidden Customername');
    ada = await createApprovedAssistant(admin, {
      displayName: 'Ada Privacy',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
    bola = await createApprovedAssistant(admin, {
      displayName: 'Bola Privacy',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
    requestId = await postRequest(customer, catalog, { description: SECRET_JOB });
    await postQuote(ada, requestId, 812_345, 'Competitor-only message 5519.');
  });

  /** Everything about an assistant that must never be public. */
  const assistantSecrets = (a: Assistant) => [
    a.legalName,
    a.phone,
    a.phone.slice(1), // national format without the leading zero
    a.account.email,
    a.account.id,
    'VID-E2E-1',
    'MANUAL_REVIEW',
  ];

  test('public pages and public API responses expose no private assistant data and no request text', async ({
    page,
  }) => {
    const pages = ['/', '/search', '/assistants', `/assistants/${ada.slug}`];
    for (const path of pages) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const html = await page.content();
      for (const secret of [...assistantSecrets(ada), ...assistantSecrets(bola)]) {
        expect(html, `${path} leaked ${secret}`).not.toContain(secret);
      }
      for (const secret of [SECRET_JOB, 'Hidden Customername', customer.email, 'Competitor-only']) {
        expect(html, `${path} leaked ${secret}`).not.toContain(secret);
      }
    }
    // The profile still shows what is meant to be public.
    await page.goto(`/assistants/${ada.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ada Privacy' })).toBeVisible();

    for (const path of ['/assistants', `/assistants/${ada.slug}`]) {
      const res = await call('GET', path);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      for (const secret of [...assistantSecrets(ada), SECRET_JOB, customer.email]) {
        expect(body, `API ${path} leaked ${secret}`).not.toContain(secret);
      }
    }
  });

  test("an assistant sees the job but never the customer, and never another assistant's quote", async ({
    page,
  }) => {
    await loginViaUi(page, bola.account);
    for (const path of ['/assistant/requests', `/assistant/requests/${requestId}`]) {
      await page.goto(path);
      const html = await page.content();
      for (const secret of [customer.email, customer.id, 'Hidden Customername']) {
        expect(html, `${path} leaked ${secret}`).not.toContain(secret);
      }
      for (const secret of ['812,345', '812345', 'Competitor-only', ada.legalName, ada.phone]) {
        expect(html, `${path} leaked ${secret}`).not.toContain(secret);
      }
    }
    // The matching assistant may read the job itself.
    await page.goto(`/assistant/requests/${requestId}`);
    await expect(page.getByText(SECRET_JOB)).toBeVisible();

    for (const path of ['/assistants/me/requests', `/assistants/me/requests/${requestId}`]) {
      const res = await apiThroughWeb(page, 'GET', path);
      expect(res.status).toBe(200);
      for (const secret of [
        customer.email,
        customer.id,
        'customerId',
        '812345',
        'Competitor-only',
      ]) {
        expect(res.text, `API ${path} leaked ${secret}`).not.toContain(secret);
      }
    }
    await page.goto('/assistant/quotes');
    expect(await page.content()).not.toContain('812,345');
  });

  test('a customer sees quotes with public assistant information only', async ({ page }) => {
    await loginViaUi(page, customer);
    await page.goto(`/requests/${requestId}`);
    await expect(page.locator('main')).toContainText('Ada Privacy');
    await expect(page.locator('main')).toContainText('8,123.45');
    const html = await page.content();
    for (const secret of assistantSecrets(ada)) {
      expect(html, `request page leaked ${secret}`).not.toContain(secret);
    }
    const res = await apiThroughWeb(page, 'GET', `/service-requests/${requestId}`);
    for (const secret of assistantSecrets(ada)) {
      expect(res.text, `API leaked ${secret}`).not.toContain(secret);
    }
  });

  test('administrators and other customers cannot read request text either', async ({
    page,
    browser,
  }) => {
    await loginViaUi(page, admin);
    expect((await page.goto(`/requests/${requestId}`))?.status()).toBe(404);
    const viaApi = await apiThroughWeb(page, 'GET', `/service-requests/${requestId}`);
    expect([403, 404]).toContain(viaApi.status); // admins get no access to request data at all
    expect(viaApi.text).not.toContain('Zebra-crossing');

    const other = await createCustomer('Another Customer');
    const context = await browser.newContext();
    const otherPage = await context.newPage();
    await loginViaUi(otherPage, other);
    await otherPage.goto('/requests');
    expect(await otherPage.content()).not.toContain('Zebra-crossing');
    await context.close();
  });
});
