import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/frontend/foodsave-auth-client.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function saveCharityOrganizationProfile(');
const end = source.indexOf('\n  async function ', start + 1);
assert.ok(start >= 0 && end > start, 'Charity onboarding function must be present.');
const context = {
  isMissingCharityGeoColumn: () => false,
  withoutCharityGeoColumns: (payload) => payload,
};
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.save = saveCharityOrganizationProfile;`, context);

function createClient(existing) {
  const writes = [];
  return {
    writes,
    from(table) {
      assert.equal(table, 'charity_profiles');
      const builder = {
        select() { return this; },
        eq() { return this; },
        async limit() { return { data: existing ? [existing] : [], error: null }; },
        update(payload) { writes.push({ operation: 'update', payload: JSON.parse(JSON.stringify(payload)) }); return this; },
        insert(payload) { writes.push({ operation: 'insert', payload: JSON.parse(JSON.stringify(payload)) }); return this; },
        async single() { return { data: { id: existing?.id || 'new-charity', ...writes.at(-1).payload }, error: null }; },
      };
      return builder;
    },
  };
}

test('retrying charity onboarding updates editable data without changing administrator approval', async () => {
  const client = createClient({ id: 'existing-charity', slug: 'existing-slug' });
  await context.save(client, {
    id: 'ignored-client-id', owner_id: 'owner-id', name: 'Updated organization',
    slug: 'new-slug', status: 'pending',
  });
  assert.deepEqual(client.writes, [{ operation: 'update', payload: {
    owner_id: 'owner-id', name: 'Updated organization', slug: 'existing-slug',
  } }]);
});

test('new charity onboarding still creates a pending organization for review', async () => {
  const client = createClient(null);
  const payload = { owner_id: 'owner-id', name: 'New organization', slug: 'new-slug', status: 'pending' };
  await context.save(client, payload);
  assert.deepEqual(client.writes, [{ operation: 'insert', payload }]);
});
