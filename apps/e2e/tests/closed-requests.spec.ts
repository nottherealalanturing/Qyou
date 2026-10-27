import { expect, test } from '@playwright/test';
import type { Account } from '../src/api.js';
import { db } from '../src/db.js';
import {
  createAdmin,
  createApprovedAssistant,
  createCustomer,
  insertExpiredRequest,
  insertQuoteRow,
  postQuote,
  postRequest,
  type Assistant,
  type Catalog,
} from '../src/fixtures.js';
import { getCatalog } from '../src/state.js';
import { apiThroughWeb, loginViaUi } from '../src/ui.js';

test.describe('closed, cancelled and expired requests', () => {
  let catalog: Catalog;
  let customer: Account;
  let ada: Assistant;
  let bola: Assistant;

  test.beforeAll(async () => {
    catalog = getCatalog();
    const admin = await createAdmin();
    customer = await createCustomer('Closing Customer');
    ada = await createApprovedAssistant(admin, {
      displayName: 'Ada Closed',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
    bola = await createApprovedAssistant(admin, {
      displayName: 'Bola Closed',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id],
    });
  });

  test('cancelling needs no reason before a quote is accepted; quoting then stops', async ({
    page,
    browser,
  }) => {
    const id = await postRequest(customer, catalog);
    await postQuote(ada, id, 700_000);

    await loginViaUi(page, customer);
    await page.goto(`/requests/${id}`);
    await page.getByRole('button', { name: 'Cancel this request' }).click();
    await expect(page.getByText('Reason (optional)')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.getByText('This request was cancelled.')).toBeVisible();
    const state = await db().query(
      `SELECT r.status AS request, q.status AS quote, r."closureReason" AS reason
       FROM service_requests r JOIN quotes q ON q."requestId" = r.id WHERE r.id = $1`,
      [id],
    );
    expect(state.rows).toEqual([{ request: 'CANCELLED', quote: 'REQUEST_CLOSED', reason: null }]);

    // The assistant who already quoted still sees the request, closed, with no way to quote.
    const adaContext = await browser.newContext();
    const adaPage = await adaContext.newPage();
    await loginViaUi(adaPage, ada.account);
    await adaPage.goto(`/assistant/requests/${id}`);
    await expect(adaPage.getByText('This request is no longer accepting quotes.')).toBeVisible();
    await expect(adaPage.getByRole('button', { name: 'Send quote' })).toHaveCount(0);
    await adaPage.goto('/assistant/quotes');
    await expect(adaPage.getByText('Closed: the request was cancelled').first()).toBeVisible();
    await adaContext.close();

    // Another matching assistant gets nothing.
    const bolaContext = await browser.newContext();
    const bolaPage = await bolaContext.newPage();
    await loginViaUi(bolaPage, bola.account);
    expect((await bolaPage.goto(`/assistant/requests/${id}`))?.status()).toBe(404);
    const refused = await apiThroughWeb(bolaPage, 'POST', `/assistants/me/requests/${id}/quotes`, {
      amountKobo: 500_000,
    });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain('no longer accepting quotes');
    await bolaContext.close();
    expect(
      (await db().query('SELECT count(*)::int AS n FROM quotes WHERE "requestId" = $1', [id]))
        .rows[0].n,
    ).toBe(1);
  });

  test('after a quote is accepted, cancelling requires a reason (documented M1.5 rule)', async ({
    page,
  }) => {
    const id = await postRequest(customer, catalog);
    const quoteId = await postQuote(ada, id, 800_000);
    await loginViaUi(page, customer);
    await page.goto(`/requests/${id}`);
    await page.getByRole('button', { name: /Accept this quote/ }).click();
    await page.getByRole('button', { name: 'Yes, accept' }).click();
    await expect(page.getByRole('heading', { name: 'Accepted quote' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel this request' }).click();
    await expect(page.getByText('Reason (required: an assistant was chosen)')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel request' }).click(); // no reason: refused
    await expect(
      page.getByText('Say why you are cancelling after accepting a quote'),
    ).toBeVisible();
    await page.getByLabel(/Reason/).fill('   '); // whitespace is no reason either
    await page.getByRole('button', { name: 'Cancel request' }).click();
    await expect(
      page.getByText('Say why you are cancelling after accepting a quote'),
    ).toBeVisible();
    let state = await db().query('SELECT status FROM service_requests WHERE id = $1', [id]);
    expect(state.rows[0].status).toBe('QUOTE_ACCEPTED');

    await page.getByLabel(/Reason/).fill('I found another way to do it.');
    await page.getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.getByText('This request was cancelled.')).toBeVisible();
    await expect(page.getByText('I found another way to do it.')).toBeVisible();
    state = await db().query(
      `SELECT r.status AS request, q.status AS quote FROM service_requests r JOIN quotes q ON q.id = $2 WHERE r.id = $1`,
      [id, quoteId],
    );
    expect(state.rows).toEqual([{ request: 'CANCELLED', quote: 'REQUEST_CLOSED' }]);
  });

  test('an accepted request takes no further quotes', async ({ browser }) => {
    const id = await postRequest(customer, catalog);
    const quoteId = await postQuote(ada, id, 810_000);
    const page = await (await browser.newContext()).newPage();
    await loginViaUi(page, customer);
    await page.goto(`/requests/${id}`);
    await page.getByRole('button', { name: /Accept this quote/ }).click();
    await page.getByRole('button', { name: 'Yes, accept' }).click();
    await expect(page.getByRole('heading', { name: 'Accepted quote' })).toBeVisible();

    const bolaPage = await (await browser.newContext()).newPage();
    await loginViaUi(bolaPage, bola.account);
    const late = await apiThroughWeb(bolaPage, 'POST', `/assistants/me/requests/${id}/quotes`, {
      amountKobo: 400_000,
    });
    expect(late.status).toBe(409);
    // The accepted assistant cannot withdraw it through the assistant API either.
    const adaPage = await (await browser.newContext()).newPage();
    await loginViaUi(adaPage, ada.account);
    const withdraw = await apiThroughWeb(
      adaPage,
      'POST',
      `/assistants/me/quotes/${quoteId}/withdraw`,
      {},
    );
    expect(withdraw.status).toBe(409);
    await adaPage.goto(`/assistant/requests/${id}`);
    await expect(adaPage.getByRole('button', { name: 'Withdraw quote' })).toHaveCount(0);
  });

  test('an expired request reads as expired, takes no quotes and cannot be accepted', async ({
    page,
    browser,
  }) => {
    const id = await insertExpiredRequest(customer, catalog);
    await insertQuoteRow(ada, id, 750_000); // sent before it expired

    await loginViaUi(page, customer);
    await page.goto(`/requests/${id}`);
    await expect(page.getByText('Expired').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Accept this quote/ })).toHaveCount(0);
    await expect(page.getByText('This request is no longer accepting decisions.')).toBeVisible();
    const selected = await apiThroughWeb(
      page,
      'POST',
      `/service-requests/${id}/quotes/${(await db().query('SELECT id FROM quotes WHERE "requestId" = $1', [id])).rows[0].id}/select`,
      {},
    );
    expect(selected.status).toBe(409);
    expect(selected.text).toContain('expired');

    // A matching assistant who never quoted sees nothing and cannot quote.
    const bolaContext = await browser.newContext();
    const bolaPage = await bolaContext.newPage();
    await loginViaUi(bolaPage, bola.account);
    await bolaPage.goto('/assistant/requests');
    await expect(bolaPage.locator(`a[href="/assistant/requests/${id}"]`)).toHaveCount(0);
    expect((await bolaPage.goto(`/assistant/requests/${id}`))?.status()).toBe(404);
    const refused = await apiThroughWeb(bolaPage, 'POST', `/assistants/me/requests/${id}/quotes`, {
      amountKobo: 500_000,
    });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain('no longer accepting quotes');
    await bolaContext.close();

    const state = await db().query('SELECT status FROM service_requests WHERE id = $1', [id]);
    expect(state.rows[0].status).toBe('OPEN'); // expiry is derived, never stored
  });
});
