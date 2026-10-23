import { AuditService } from '../src/audit/audit.service.js';
import {
  client,
  createTestApp,
  createUser,
  ownerPrisma,
  resetDatabase,
  type TestContext,
} from './support/test-app.js';

/** Flattens a Prisma error (message + driver meta + code) so we can match on the DB's wording. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const e = error as { message?: string; code?: string; meta?: unknown };
    return `${e.message ?? ''} ${e.code ?? ''} ${JSON.stringify(e.meta ?? {})}`;
  }
  return 'NO ERROR';
}

describe('audit_logs integrity (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;
  let api: ReturnType<typeof client>;
  let audit: AuditService;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx.app);
    audit = ctx.app.get(AuditService);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedRow() {
    await audit.record({ action: 'test.seed', metadata: { marker: 'original' } });
    return ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'test.seed' } });
  }

  describe('layer 1: the application role has no way to rewrite history', () => {
    it('connects as a least-privilege role (not owner, not superuser)', async () => {
      const [who] = await ctx.prisma.$queryRaw<
        { current_user: string; is_super: boolean }[]
      >`SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super`;
      expect(who?.current_user).toBe('qyou_runtime');
      expect(who?.is_super).toBe(false);
      const [owner] = await ctx.prisma.$queryRaw<
        { tableowner: string }[]
      >`SELECT tableowner FROM pg_tables WHERE tablename = 'audit_logs'`;
      expect(owner?.tableowner).not.toBe('qyou_runtime');
    });

    it('can INSERT and SELECT audit rows (normal operation keeps working)', async () => {
      const row = await seedRow();
      expect(row.metadata).toEqual({ marker: 'original' });
      await createUser(api); // real flows write audit rows too
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.register' } })).toBe(1);
    });

    it('cannot UPDATE audit rows (raw SQL and ORM)', async () => {
      const row = await seedRow();
      expect(
        await dbError(ctx.prisma.$executeRaw`UPDATE audit_logs SET action = 'tampered'`),
      ).toMatch(/permission denied|42501/i);
      expect(
        await dbError(
          ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
        ),
      ).toMatch(/permission denied|42501/i);
      expect(await dbError(ctx.prisma.auditLog.updateMany({ data: { ip: '6.6.6.6' } }))).toMatch(
        /permission denied|42501/i,
      );
      expect(await ctx.prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    });

    it('cannot DELETE or TRUNCATE audit rows (raw SQL and ORM)', async () => {
      const row = await seedRow();
      expect(await dbError(ctx.prisma.$executeRaw`DELETE FROM audit_logs`)).toMatch(
        /permission denied|42501/i,
      );
      expect(await dbError(ctx.prisma.auditLog.delete({ where: { id: row.id } }))).toMatch(
        /permission denied|42501/i,
      );
      expect(await dbError(ctx.prisma.auditLog.deleteMany())).toMatch(/permission denied|42501/i);
      expect(await dbError(ctx.prisma.$executeRawUnsafe('TRUNCATE TABLE audit_logs'))).toMatch(
        /permission denied|42501/i,
      );
      expect(await ctx.prisma.auditLog.count()).toBe(1);
    });

    it('cannot remove the protections: no ALTER/DROP, no disabling triggers, no self-granting', async () => {
      const attempts = [
        'ALTER TABLE audit_logs DISABLE TRIGGER USER',
        'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update_delete',
        'DROP TRIGGER audit_logs_no_update_delete ON audit_logs',
        'DROP TABLE audit_logs',
        'ALTER TABLE audit_logs RENAME TO audit_logs_old',
        'DROP FUNCTION audit_logs_reject_mutation() CASCADE',
        'CREATE TABLE public.sneaky (id int)',
        'SET ROLE qyou',
        'SET session_replication_role = replica',
      ];
      for (const sql of attempts) {
        expect(await dbError(ctx.prisma.$executeRawUnsafe(sql))).toMatch(
          /must be owner|permission denied|42501|not permitted/i,
        );
      }
      const triggers = await ownerPrisma().$queryRaw<{ tgname: string; tgenabled: string }[]>`
        SELECT tgname::text AS tgname, tgenabled::text AS tgenabled FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal ORDER BY tgname`;
      expect(triggers).toEqual([
        { tgname: 'audit_logs_no_truncate', tgenabled: 'O' },
        { tgname: 'audit_logs_no_update_delete', tgenabled: 'O' },
      ]);
    });

    it('cannot grant itself more: a non-owner GRANT is a no-op (PostgreSQL only warns)', async () => {
      for (const role of ['qyou_app', 'qyou_runtime', 'PUBLIC']) {
        await ctx.prisma.$executeRawUnsafe(
          `GRANT UPDATE, DELETE, TRUNCATE ON audit_logs TO ${role}`,
        );
      }
      const privileges = await ownerPrisma().$queryRaw<
        { role: string; priv: string; allowed: boolean }[]
      >`
        SELECT r.role, p.priv, has_table_privilege(r.role, 'audit_logs', p.priv) AS allowed
        FROM (VALUES ('qyou_app'), ('qyou_runtime')) AS r(role)
        CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)`;
      expect(privileges.filter((p) => p.allowed)).toEqual([]);
      expect(await dbError(ctx.prisma.$executeRaw`UPDATE audit_logs SET action = 'x'`)).toMatch(
        /permission denied|42501/i,
      );
    });

    it('cannot read or alter Prisma’s migration bookkeeping', async () => {
      expect(await dbError(ctx.prisma.$queryRawUnsafe('SELECT * FROM _prisma_migrations'))).toMatch(
        /permission denied|42501/i,
      );
    });

    it('still has normal read/write access to ordinary tables', async () => {
      const user = await createUser(api);
      await ctx.prisma.user.update({ where: { id: user.id }, data: { name: 'Renamed' } });
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(
        'Renamed',
      );
    });
  });

  describe('layer 2: triggers stop even the table owner', () => {
    it('rejects UPDATE, DELETE and TRUNCATE for the owner role', async () => {
      const row = await seedRow();
      const owner = ownerPrisma();
      expect(await dbError(owner.$executeRaw`UPDATE audit_logs SET action = 'tampered'`)).toMatch(
        /append-only/i,
      );
      expect(await dbError(owner.$executeRaw`DELETE FROM audit_logs`)).toMatch(/append-only/i);
      expect(await dbError(owner.$executeRawUnsafe('TRUNCATE TABLE audit_logs'))).toMatch(
        /append-only/i,
      );
      expect(await ctx.prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    });

    it('still lets the owner INSERT (so migrations/maintenance can append)', async () => {
      await ownerPrisma()
        .$executeRaw`INSERT INTO audit_logs (id, action) VALUES (gen_random_uuid(), 'owner.insert')`;
      expect(await ctx.prisma.auditLog.count({ where: { action: 'owner.insert' } })).toBe(1);
    });
  });

  describe('referential independence', () => {
    it('keeps audit rows (unchanged) when the user they refer to is deleted', async () => {
      const user = await createUser(api);
      const before = await ctx.prisma.auditLog.findMany({ where: { actorUserId: user.id } });
      expect(before.length).toBeGreaterThan(0);
      await ctx.prisma.user.delete({ where: { id: user.id } }); // sessions/tokens cascade; audit must not
      expect(await ctx.prisma.auditLog.findMany({ where: { actorUserId: user.id } })).toEqual(
        before,
      );
    });

    it('has no foreign key from audit_logs to users', async () => {
      const fks = await ownerPrisma().$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conrelid = 'audit_logs'::regclass AND contype = 'f'`;
      expect(fks).toEqual([]);
    });
  });

  describe('audit writes are transactional with the change they describe', () => {
    it('rolls the audit row back together with a failed operation', async () => {
      await createUser(api, { email: 'dup@example.test' });
      const before = await ctx.prisma.auditLog.count({ where: { action: 'auth.register' } });
      await api.register({ email: 'dup@example.test' }).expect(409);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.register' } })).toBe(before);
    });
  });
});
