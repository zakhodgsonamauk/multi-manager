import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLaunchCommand, claudeArgs, pluginsToDisable, type LaunchSpec } from '../src/launch/command.ts';
import { SkillIndex, installedPluginFolders, loadSkill, resolve, search, type PluginFolder } from '../src/roster/skill-broker.ts';

function fakePlugins(): { folders: PluginFolder[]; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  const a = join(root, 'render');
  mkdirSync(join(a, 'skills', 'render-deploy', 'refs'), { recursive: true });
  writeFileSync(
    join(a, 'skills', 'render-deploy', 'SKILL.md'),
    '---\nname: render-deploy\ndescription: Deploy an app to Render\n---\nRun ${CLAUDE_PLUGIN_ROOT}/go.sh for $ARGUMENTS (first: $0).\n!`git status`\n```!\nnpm test\n```\n',
  );
  writeFileSync(join(a, 'skills', 'render-deploy', 'refs', 'notes.md'), 'notes');
  mkdirSync(join(a, 'commands'), { recursive: true });
  writeFileSync(join(a, 'commands', 'render-status.md'), '---\ndescription: Show service status\n---\nStatus body\n');
  const b = join(root, 'other');
  mkdirSync(join(b, 'skills', 'brainstorm'), { recursive: true });
  writeFileSync(join(b, 'skills', 'brainstorm', 'SKILL.md'), '---\nname: brainstorm\ndescription: Explore ideas before building\n---\nThink.\n');
  mkdirSync(join(b, 'commands'), { recursive: true });
  writeFileSync(join(b, 'commands', 'plan.md'), '---\ndescription: Make a plan\n---\nPlan.\n');
  return { root, folders: [{ key: 'render@m', name: 'render', root: a }, { key: 'other@m', name: 'other', root: b }] };
}

test('find_skill returns the matching skill with its plugin name', () => {
  const { folders } = fakePlugins();
  const index = new SkillIndex(() => folders);
  const hits = search(index.get(), 'deploy');
  assert.equal(hits[0]?.name, 'render-deploy');
  assert.equal(hits[0]?.plugin, 'render');
  assert.ok(!hits.some((h) => h.plugin === 'other'));
});

test('the index rebuilds when a skill is added', () => {
  const { folders } = fakePlugins();
  const index = new SkillIndex(() => folders);
  assert.equal(search(index.get(), 'cron').length, 0);
  const dir = join(folders[0]!.root, 'skills', 'render-cron');
  mkdirSync(dir);
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: render-cron\ndescription: Cron jobs\n---\nx\n');
  assert.equal(search(index.get(), 'cron')[0]?.name, 'render-cron');
});

test('load_skill substitutes plugin root and arguments, lists supporting files, marks shell lines', () => {
  const { folders } = fakePlugins();
  const entry = resolve(new SkillIndex(() => folders).get(), 'render:render-deploy').entry!;
  const out = loadSkill(entry, 'myapp prod');
  assert.ok(out.includes(`Run ${folders[0]!.root}/go.sh for myapp prod (first: myapp).`));
  assert.ok(out.includes(join(folders[0]!.root, 'skills', 'render-deploy', 'refs', 'notes.md')));
  assert.match(out, /SHELL COMMAND, NOT RUN.*git status/);
  assert.match(out, /SHELL COMMANDS, NOT RUN[\s\S]*npm test/);
});

test('an unknown name suggests close matches; a bare unique name resolves', () => {
  const { folders } = fakePlugins();
  const idx = new SkillIndex(() => folders).get();
  const miss = resolve(idx, 'render-deplyo');
  assert.equal(miss.entry, undefined);
  assert.equal(resolve(idx, 'brainstorm').entry?.plugin, 'other');
  assert.equal(resolve(idx, 'deploy').suggestions[0]?.name, 'render-deploy');
});

const base: LaunchSpec = {
  wtPath: 'wt.exe', name: 'mm-a-main', folder: 'C:/w', role: 'architect', skipPermissions: true,
  briefingFile: 'b.md', pluginDir: 'p', settingsPath: 's.json', prompt: 'hi', sessionId: 7, parentId: 1, rosterDb: 'r.db',
};

test('manager tab settings switch off every installed plugin except the keep-list, and the connectors', () => {
  const keys = ['render@claude-plugins-official', 'multi-manager@inline', 'second-opinion@x', 'code-review-graph@y', 'orchestrator-supaconductor@z'];
  const off = pluginsToDisable(keys);
  assert.deepEqual(off, ['render@claude-plugins-official', 'orchestrator-supaconductor@z']);
  const settings = JSON.parse(buildLaunchCommand({ ...base, disabledPlugins: off }).settings.content);
  assert.deepEqual(settings.enabledPlugins, { 'render@claude-plugins-official': false, 'orchestrator-supaconductor@z': false });
  assert.equal(settings.disableClaudeAiConnectors, true);
  assert.ok(claudeArgs(base).includes('--settings'));
});

test('without disabledPlugins (front desk) settings are unchanged', () => {
  const settings = JSON.parse(buildLaunchCommand(base).settings.content);
  assert.deepEqual(Object.keys(settings), ['env']);
});

function oneSkill(body: string): ReturnType<typeof resolve>['entry'] & object {
  const root = mkdtempSync(join(tmpdir(), 'argsk-'));
  mkdirSync(join(root, 'skills', 's'), { recursive: true });
  writeFileSync(join(root, 'skills', 's', 'SKILL.md'), `---\nname: s\ndescription: d\n---\n${body}\n`);
  return resolve(new SkillIndex(() => [{ key: 'p@m', name: 'p', root }]).get(), 's').entry!;
}

test('arguments are 0-based: $0 and $ARGUMENTS[0] are the first argument', () => {
  const out = loadSkill(oneSkill('A=$0 B=$ARGUMENTS[1] ALL=$ARGUMENTS'), 'x "y z"');
  assert.match(out, /A=x B=y z ALL=x "y z"/);
});

test('an unmatched $N is left as written (awk, regex back-references)', () => {
  const out = loadSkill(oneSkill("awk '{print $1}' and $2 with $0"), 'only');
  assert.match(out, /awk '\{print \$1\}' and \$2 with only/);
});

test('$ and $& inside args are inserted literally, never re-expanded', () => {
  const out = loadSkill(oneSkill('first=$0 all=$ARGUMENTS'), "a$&b $1");
  assert.match(out, /first=a\$&b all=a\$&b \$1/);
});

test('args are appended as ARGUMENTS: when the body has no placeholder; none given adds nothing', () => {
  const entry = oneSkill('Plain body');
  assert.match(loadSkill(entry, 'hello there'), /Plain body\n\nARGUMENTS: hello there/);
  assert.doesNotMatch(loadSkill(entry, ''), /ARGUMENTS:/);
});

test('plugin root with $ characters is inserted literally', () => {
  const entry = { ...oneSkill('r=${CLAUDE_PLUGIN_ROOT}'), pluginRoot: 'C:/a$&b' };
  assert.match(loadSkill(entry), /r=C:\/a\$&b/);
});

test('installedPluginFolders survives a missing, malformed, null or wrongly shaped file', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  assert.deepEqual(installedPluginFolders(home), []);
  mkdirSync(join(home, 'plugins'), { recursive: true });
  for (const text of ['{ not json', 'null', '[]', '{"plugins":null}', '{"plugins":{"a@m":null,"b@m":[null],"c@m":"x"}}']) {
    writeFileSync(join(home, 'plugins', 'installed_plugins.json'), text);
    assert.deepEqual(installedPluginFolders(home), [], text);
  }
  const root = join(home, 'cache');
  mkdirSync(root);
  writeFileSync(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'ok@m': [{ installPath: root }] } }));
  assert.deepEqual(installedPluginFolders(home), [{ key: 'ok@m', name: 'ok', root }]);
});

test('the index picks up an edited command file', async () => {
  const { folders } = fakePlugins();
  const index = new SkillIndex(() => folders);
  assert.equal(search(index.get(), 'status')[0]?.description, 'Show service status');
  const file = join(folders[0]!.root, 'commands', 'render-status.md');
  writeFileSync(file, '---\ndescription: Brand new words\n---\nbody\n');
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(search(index.get(), 'status')[0]?.description, 'Brand new words');
});

test('the supporting-file list is capped', () => {
  const root = mkdtempSync(join(tmpdir(), 'cap-'));
  const dir = join(root, 'skills', 's');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: s\n---\nb\n');
  for (let i = 0; i < 150; i++) writeFileSync(join(dir, `f${i}.txt`), 'x');
  const entry = resolve(new SkillIndex(() => [{ key: 'p@m', name: 'p', root }]).get(), 's').entry!;
  assert.equal(loadSkill(entry).split('\n').filter((l) => l.startsWith('- ')).length, 100);
});

test('voice, sounds and claudish plugins stay on', () => {
  const off = pluginsToDisable(['session-voice@session-voice', 'cc-sounds@cc-sounds', 'claudish-to-english@gvzdv-plugins', 'render@x']);
  assert.deepEqual(off, ['render@x']);
});
