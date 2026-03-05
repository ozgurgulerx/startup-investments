import { strict as assert } from 'node:assert';
import { resolveEditorialPath } from '../lib/api/editorial-path';

function run(): void {
  assert.equal(resolveEditorialPath(null), 'review');
  assert.equal(resolveEditorialPath(''), 'review');
  assert.equal(resolveEditorialPath(' review '), 'review');
  assert.equal(resolveEditorialPath('actions'), 'actions');
  assert.equal(resolveEditorialPath('rules'), 'rules');
  assert.equal(resolveEditorialPath('stats'), 'stats');
  assert.equal(
    resolveEditorialPath('rules/00000000-0000-0000-0000-000000000001'),
    'rules/00000000-0000-0000-0000-000000000001',
  );

  assert.equal(resolveEditorialPath('../monitoring/runtime'), null);
  assert.equal(resolveEditorialPath('/api/admin/editorial/review'), null);
  assert.equal(resolveEditorialPath('rules/not-a-uuid'), null);
  assert.equal(resolveEditorialPath('rules/00000000-0000-0000-0000-000000000001/extra'), null);
}

run();
console.log('editorial path tests passed');
