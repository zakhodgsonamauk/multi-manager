import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWorkModel, resolveLaunchModel, resolveModelTier, WORK_MODELS } from '../src/roster/models.ts';

test('the work tiers are haiku, sonnet, opus', () => {
  assert.deepEqual(WORK_MODELS, ['haiku', 'sonnet', 'opus']);
  assert.ok(isWorkModel('sonnet'));
  assert.ok(!isWorkModel('fable')); // fable is manual, not a work tier
});

test('resolveModelTier: the fixed rule maps (complexity, clarity) to a tier', () => {
  // demand = complexity + (6 - clarity); 2..3 haiku, 4..7 sonnet, 8..10 opus
  assert.equal(resolveModelTier(1, 5), 'haiku'); // 2
  assert.equal(resolveModelTier(1, 4), 'haiku'); // 3
  assert.equal(resolveModelTier(2, 4), 'sonnet'); // 4
  assert.equal(resolveModelTier(1, 1), 'sonnet'); // 6
  assert.equal(resolveModelTier(5, 5), 'sonnet'); // 6: hard but fully specified
  assert.equal(resolveModelTier(2, 1), 'sonnet'); // 7
  assert.equal(resolveModelTier(4, 2), 'opus'); // 8
  assert.equal(resolveModelTier(3, 1), 'opus'); // 8: easy but vague
  assert.equal(resolveModelTier(5, 1), 'opus'); // 10
});

test('resolveLaunchModel: an override wins', () => {
  assert.equal(
    resolveLaunchModel({ role: 'developer', modelOverride: 'opus', complexity: 1, clarity: 5, projectDefaultModel: 'sonnet' }),
    'opus',
  );
});

test('resolveLaunchModel: a scored developer maps through the rule', () => {
  assert.equal(
    resolveLaunchModel({ role: 'developer', modelOverride: null, complexity: 5, clarity: 1, projectDefaultModel: 'haiku' }),
    'opus',
  );
});

test('resolveLaunchModel: an unscored developer and every architect fall back to the project default, then sonnet', () => {
  assert.equal(resolveLaunchModel({ role: 'developer', modelOverride: null, complexity: null, clarity: null, projectDefaultModel: 'haiku' }), 'haiku');
  assert.equal(resolveLaunchModel({ role: 'architect', modelOverride: null, complexity: null, clarity: null, projectDefaultModel: null }), 'sonnet');
  assert.equal(resolveLaunchModel({ role: 'architect', modelOverride: null, complexity: null, clarity: null, projectDefaultModel: 'opus' }), 'opus');
});
