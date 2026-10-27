import { expect, test, type Page } from '@playwright/test';
import type { Account } from '../src/api.js';
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
import { hasHorizontalOverflow, loginViaUi } from '../src/ui.js';

const PHONE = { width: 375, height: 812 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

/** Nothing the page renders may be wider than the screen, and every control must stay on-screen. */
async function expectFitsPhone(page: Page, path: string): Promise<void> {
  expect(await hasHorizontalOverflow(page), `${path} scrolls sideways at ${PHONE.width}px`).toBe(
    false,
  );
  const offscreen = await page.evaluate((width) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      'main a, main button, header a, header button, main input, main select, main textarea',
    )) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && (box.right > width + 1 || box.left < -1)) {
        bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
      }
    }
    return bad;
  }, PHONE.width);
  expect(offscreen, `${path} has controls outside the screen`).toEqual([]);
}

test.describe('critical marketplace pages at phone width (375px)', () => {
  let catalog: Catalog;
  let customer: Account;
  let ada: Assistant;
  let requestId: string;

  test.beforeAll(async () => {
    catalog = getCatalog();
    const admin = await createAdmin();
    customer = await createCustomer('Mobile Customer');
    ada = await createApprovedAssistant(admin, {
      displayName: 'Ada Mobile',
      cityIds: [catalog.cityA.id],
      taskIds: [catalog.hold.id, catalog.docs.id],
    });
    requestId = await postRequest(customer, catalog);
    await postQuote(ada, requestId, 910_000);
  });

  test('public pages fit', async ({ page }) => {
    for (const path of ['/', '/assistants', `/assistants/${ada.slug}`, '/login', '/register']) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expectFitsPhone(page, path);
    }
  });

  test('customer pages fit, and a quote can be accepted with taps', async ({ page }) => {
    await loginViaUi(page, customer);
    for (const path of ['/requests', '/requests/new', `/requests/${requestId}`]) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expectFitsPhone(page, path);
    }
    // The primary action is reachable and works on a touch screen.
    await page.getByRole('button', { name: /Accept this quote/ }).tap();
    await expect(page.getByRole('button', { name: 'Yes, accept' })).toBeInViewport();
    await expectFitsPhone(page, 'confirm step');
    await page.getByRole('button', { name: 'Yes, accept' }).tap();
    await expect(page.getByRole('heading', { name: 'Accepted quote' })).toBeVisible();
    await expectFitsPhone(page, 'accepted request');
  });

  test('assistant pages fit, and a quote can be sent and withdrawn with taps', async ({ page }) => {
    const second = await postRequest(customer, catalog);
    await loginViaUi(page, ada.account);
    for (const path of [
      '/assistant/requests',
      `/assistant/requests/${second}`,
      '/assistant/quotes',
    ]) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expectFitsPhone(page, path);
    }
    await page.goto(`/assistant/requests/${second}`);
    await page.getByLabel('Your price (₦)').fill('4000');
    await page.getByRole('button', { name: 'Send quote' }).tap();
    await expect(page.getByRole('heading', { name: 'Your quote' })).toBeVisible();
    await expectFitsPhone(page, 'quote sent');
    await page.getByRole('button', { name: 'Withdraw quote' }).tap();
    await expect(page.getByText('You withdrew this quote')).toBeVisible();
  });
});
