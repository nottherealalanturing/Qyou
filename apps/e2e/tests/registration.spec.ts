import { expect, test } from '@playwright/test';
import { call } from '../src/api.js';
import { db, resetRateLimits } from '../src/db.js';
import { createCustomer, uid } from '../src/fixtures.js';
import { PASSWORD } from '../src/env.js';
import { loginViaUi } from '../src/ui.js';

const SIGN_UP = async (
  page: import('@playwright/test').Page,
  email: string,
  name = 'Ada Registrant',
  password = PASSWORD,
) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
};

test.describe('registration reveals nothing about existing addresses', () => {
  test.beforeEach(async () => {
    await resetRateLimits();
  });

  test('a new visitor registers, sees the neutral panel, is not signed in, then logs in', async ({
    page,
  }) => {
    const email = `new-${uid()}@example.test`;
    await SIGN_UP(page, email);

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    // Not signed in: a protected page sends them to log in.
    await page.goto('/requests');
    await expect(page).toHaveURL(/\/login\?next=/);

    const row = await db().query('SELECT "emailVerifiedAt", role FROM users WHERE email = $1', [
      email,
    ]);
    expect(row.rows).toEqual([{ emailVerifiedAt: null, role: 'CUSTOMER' }]);

    // The password chosen at registration works for the first login.
    await loginViaUi(page, {
      id: '',
      email,
      name: 'Ada Registrant',
      password: PASSWORD,
      token: '',
    });
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });

  test('existing verified, unverified and suspended addresses get the identical page', async ({
    page,
    browser,
  }) => {
    const verified = await createCustomer('Vera Verified');
    const unverified = await createCustomer('Una Unverified');
    await db().query('UPDATE users SET "emailVerifiedAt" = NULL WHERE id = $1', [unverified.id]);
    const suspended = await createCustomer('Sam Suspended');
    await db().query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [suspended.id]);

    const panelFor = async (email: string) => {
      await resetRateLimits();
      const context = await browser.newContext();
      const p = await context.newPage();
      await SIGN_UP(p, email, 'Different Person', 'attacker-chosen-password-1');
      await expect(p.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      const html = await p.getByRole('status').innerHTML();
      const text = await p.getByRole('status').innerText();
      await expect(p.getByRole('alert').filter({ hasText: /./ })).toHaveCount(0);
      await context.close();
      return { html, text };
    };

    const fresh = await panelFor(`fresh-${uid()}@example.test`);
    for (const account of [verified, unverified, suspended]) {
      const seen = await panelFor(account.email);
      expect(seen.text).toBe(fresh.text);
      expect(seen.text).not.toMatch(
        /already|exists|taken|registered|suspend|verified|log in instead/i,
      );
    }

    // The words on the page are the API's words, and the API says the same for everyone.
    const api = await call('POST', '/auth/register', {
      email: verified.email,
      name: 'Probe',
      password: PASSWORD,
    });
    expect(api.status).toBe(202);
    expect(fresh.text).toContain(String((api.body as unknown as { message: string }).message));

    // Nothing about the real accounts changed: the original password still works, the attacker's does not.
    await resetRateLimits();
    expect(
      (await call('POST', '/auth/login', { email: verified.email, password: PASSWORD })).status,
    ).toBe(200);
    expect(
      (
        await call('POST', '/auth/login', {
          email: verified.email,
          password: 'attacker-chosen-password-1',
        })
      ).status,
    ).toBe(401);
    expect(
      (await db().query('SELECT count(*)::int AS n FROM users WHERE email = $1', [verified.email]))
        .rows[0].n,
    ).toBe(1);

    // Neither page signed the visitor in.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('errors depend only on what was typed: weak passwords and local validation, same for any address', async ({
    page,
  }) => {
    const existing = await createCustomer('Existing Person');
    for (const email of [existing.email, `fresh-${uid()}@example.test`]) {
      await SIGN_UP(page, email, 'Weak Password', 'password123');
      await expect(page.getByText(/too common/i)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
    }
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/already (registered|exists)|is taken/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
  });

  test('the per-IP limit answers the same wording for a new and for an existing address', async ({
    page,
  }) => {
    const existing = await createCustomer('Limited Person');
    await resetRateLimits();
    for (let i = 0; i < 10; i += 1) {
      const res = await call('POST', '/auth/register', {
        email: `burst-${uid()}@example.test`,
        name: 'Burst',
        password: PASSWORD,
      });
      expect(res.status).toBe(202);
    }
    const messages: string[] = [];
    for (const email of [existing.email, `late-${uid()}@example.test`]) {
      await SIGN_UP(page, email);
      const alert = page.getByRole('alert').filter({ hasText: 'Too many attempts' });
      await expect(alert).toBeVisible();
      messages.push(await alert.innerText());
    }
    expect(messages[0]).toBe(messages[1]);
    await resetRateLimits();
  });
});
