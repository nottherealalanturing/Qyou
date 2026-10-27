import { expect, test } from '@playwright/test';
import type { Account } from '../src/api.js';
import { db } from '../src/db.js';
import {
  createAdmin,
  createApprovedAssistant,
  createCustomer,
  postQuote,
  postRequest,
  suspend,
  type Assistant,
  type Catalog,
} from '../src/fixtures.js';
import { getCatalog } from '../src/state.js';
import { apiThroughWeb, loginViaUi } from '../src/ui.js';

test.describe('authorization and eligibility boundaries', () => {
  let catalog: Catalog;
  let admin: Account;
  let owner: Account;
  let stranger: Account;
  let ada: Assistant; // eligible, serves City A
  let carl: Assistant; // eligible, serves only City B
  let dora: Assistant; // a draft application: never eligible
  let requestId: string;
  let adaQuoteId: string;

  test.beforeAll(async () => {
    catalog = getCatalog();
    admin = await createAdmin();
    owner = await createCustomer('Owner Customer');
    stranger = await createCustomer('Stranger Customer');
    ada = await createApprovedAssistant(admin, {
      displayName: 'Ada Access',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
    carl = await createApprovedAssistant(admin, {
      displayName: 'Carl Elsewhere',
      cityIds: [catalog.cityB.id],
      taskIds: [catalog.hold.id],
    });
    dora = await createApprovedAssistant(admin, {
      displayName: 'Dora Draft',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
      stopAt: 'DRAFT',
    });
    requestId = await postRequest(owner, catalog);
    adaQuoteId = await postQuote(ada, requestId, 650_000);
  });

  test('anonymous visitors are sent to log in and returned to the page they wanted', async ({
    page,
  }) => {
    for (const path of ['/requests', '/requests/new', '/assistant/requests', '/assistant/quotes']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    }
    await loginViaUi(page, owner, '/requests');
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByRole('heading', { name: 'My requests' })).toBeVisible();
  });

  test("another customer cannot open, cancel or accept into someone else's request", async ({
    page,
  }) => {
    await loginViaUi(page, stranger);
    const response = await page.goto(`/requests/${requestId}`);
    expect(response?.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText('Ada Access');

    // The API says exactly what it says for a request that does not exist.
    const missing = await apiThroughWeb(
      page,
      'GET',
      '/service-requests/00000000-0000-4000-8000-000000000000',
    );
    const foreign = await apiThroughWeb(page, 'GET', `/service-requests/${requestId}`);
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.json).toEqual(missing.json);
    expect(
      (await apiThroughWeb(page, 'POST', `/service-requests/${requestId}/cancel`, {})).status,
    ).toBe(404);
    expect(
      (
        await apiThroughWeb(
          page,
          'POST',
          `/service-requests/${requestId}/quotes/${adaQuoteId}/select`,
          {},
        )
      ).status,
    ).toBe(404);

    const state = await db().query('SELECT status FROM service_requests WHERE id = $1', [
      requestId,
    ]);
    expect(state.rows[0].status).toBe('QUOTED');
  });

  test('an assistant who does not serve the city cannot see or quote the request', async ({
    page,
  }) => {
    await loginViaUi(page, carl.account);
    await page.goto('/assistant/requests');
    await expect(page.locator(`a[href="/assistant/requests/${requestId}"]`)).toHaveCount(0);
    expect((await page.goto(`/assistant/requests/${requestId}`))?.status()).toBe(404);
    const attempt = await apiThroughWeb(
      page,
      'POST',
      `/assistants/me/requests/${requestId}/quotes`,
      { amountKobo: 500_000 },
    );
    expect(attempt.status).toBe(404);
    expect(
      (
        await db().query('SELECT count(*)::int AS n FROM quotes WHERE "assistantId" = $1', [
          carl.profileId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  test('customers and unapproved applicants are told they are not eligible, and the API agrees', async ({
    page,
    browser,
  }) => {
    await loginViaUi(page, stranger);
    await page.goto('/assistant/requests');
    await expect(page.getByText(/once your assistant application is approved/)).toBeVisible();
    const asCustomer = await apiThroughWeb(
      page,
      'POST',
      `/assistants/me/requests/${requestId}/quotes`,
      { amountKobo: 500_000 },
    );
    expect(asCustomer.status).toBe(403);

    const context = await browser.newContext();
    const draftPage = await context.newPage();
    await loginViaUi(draftPage, dora.account);
    await draftPage.goto('/assistant/requests');
    await expect(draftPage.getByText(/once your assistant application is approved/)).toBeVisible();
    const asDraft = await apiThroughWeb(
      draftPage,
      'POST',
      `/assistants/me/requests/${requestId}/quotes`,
      { amountKobo: 500_000 },
    );
    expect(asDraft.status).toBe(403);
    await context.close();
    expect(
      (
        await db().query('SELECT count(*)::int AS n FROM quotes WHERE "assistantId" = $1', [
          dora.profileId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  test('an assistant suspended while their quote form is open is refused, and nothing is stored', async ({
    page,
  }) => {
    const eve = await createApprovedAssistant(admin, {
      displayName: 'Eve Suspended',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
    const freshRequest = await postRequest(owner, catalog);

    await loginViaUi(page, eve.account);
    await page.goto(`/assistant/requests/${freshRequest}`);
    await page.getByLabel('Your price (₦)').fill('4,200');
    await suspend(admin, eve); // the review team acts while the form is open

    await page.getByRole('button', { name: 'Send quote' }).click();
    await expect(page.getByRole('heading', { name: 'Your quote' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send quote' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Your request was blocked');
    expect(
      (
        await db().query('SELECT count(*)::int AS n FROM quotes WHERE "assistantId" = $1', [
          eve.profileId,
        ])
      ).rows[0].n,
    ).toBe(0);

    // And they no longer see the feed.
    await page.goto('/assistant/requests');
    await expect(page.getByText(/once your assistant application is approved/)).toBeVisible();
  });

  test('a suspended assistant cannot be chosen: the customer is told and the quote stays unaccepted', async ({
    page,
  }) => {
    const fay = await createApprovedAssistant(admin, {
      displayName: 'Fay Suspended Later',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
    const id = await postRequest(owner, catalog);
    await postQuote(fay, id, 900_000);
    await loginViaUi(page, owner);
    await page.goto(`/requests/${id}`);
    await expect(page.getByRole('button', { name: /Accept this quote/ })).toBeVisible();

    await suspend(admin, fay);
    await page.reload();
    await expect(page.getByRole('button', { name: /Accept this quote/ })).toHaveCount(0);
    await expect(page.getByText(/can’t take this job right now/)).toBeVisible();
    const state = await db().query(
      `SELECT r.status AS request, q.status AS quote FROM quotes q JOIN service_requests r ON r.id = q."requestId" WHERE r.id = $1`,
      [id],
    );
    expect(state.rows).toEqual([{ request: 'QUOTED', quote: 'PENDING' }]);
  });
});
