const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../yesstevevfx_studio');
const pluginSource = fs.readFileSync(path.resolve(__dirname, '../yesstevevfx_studio.js'), 'utf8');
const demo = path.resolve(__dirname, '../../examples/vfx_audio_demo');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-audio-'));
  fs.cpSync(demo, root, {recursive: true});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return core.scan(root);
}
test('audio-only pack exports Chinese paths and sound metadata', t => {
  const project = fixture(t), output = core.build(project);
  assert.equal(JSON.parse(output.get('manifest.json')).effects.length, 0);
  const audio = JSON.parse(output.get('audio.json'));
  const def = audio.sounds['yesstevevfx:vfx_audio_demo/slash'];
  assert.ok(output.get(def.file).equals(fs.readFileSync(path.join(demo, def.file))));
  assert.ok(core.inspectOgg(output.get(def.file)).duration <= .46);
});
test('audio-only export ignores a stale empty preview effect', t => {
  const project = fixture(t);
  project.effects.push({key: 'stale', enabled: true, name: 'preview', model: '', animation: '', texture: '', modelUnresolved: false});
  const output = core.build(project);
  assert.deepEqual(JSON.parse(output.get('manifest.json')).effects, []);
});
test('imports keep original filename, reuse identical files, suffix collisions', t => {
  const project = fixture(t), src = path.join(demo, 'assets/yesstevevfx/sounds/挥刀.ogg');
  const first = core.importAudio(project, src);
  assert.equal(project.audio.sounds[first].file, 'sounds/挥刀.ogg');
  // Existing file with different content: must never overwrite it.
  const target = path.join(project.root, project.audio.sounds[first].file);
  fs.writeFileSync(target, Buffer.from('other content'));
  project.audio.sounds = {};
  const next = core.importAudio(project, src);
  assert.equal(project.audio.sounds[next].file, 'sounds/挥刀_2.ogg');
  assert.equal(fs.readFileSync(target, 'utf8'), 'other content');
  assert.equal(Object.keys(core.scan(project.root).audio.sounds).length, 1);
});
test('editor rejects stereo, long, truncated and corrupt audio', () => {
  for (const name of ['stereo.ogg', 'too-long.ogg']) assert.throws(() => core.inspectOgg(fs.readFileSync(path.resolve(__dirname, '../../src/test/resources/audio', name))));
  const good = fs.readFileSync(path.join(demo, 'assets/yesstevevfx/sounds/挥刀.ogg'));
  assert.throws(() => core.inspectOgg(good.subarray(0, good.length-1)));
  good[good.length-1] ^= 1; assert.throws(() => core.inspectOgg(good));
});
test('editor rejects invalid fields before exporting a broken runtime pack', t => {
  const project = fixture(t), original = structuredClone(project.audio);
  for (const change of [s => s.volume = 2, s => s.follow = 'true', s => s.range = null, s => s.extra = 1]) {
    project.audio = structuredClone(original); change(Object.values(project.audio.sounds)[0]);
    assert.throws(() => core.build(project));
  }
});
test('exports YSS hit bindings and rejects duplicate selectors', t => {
  const project = fixture(t), sound = Object.keys(project.audio.sounds)[0];
  project.audio.hit_bindings = [{model_id: 'geometry.wuwa', animation: 'attack_1', segment_index: 0, sound}];
  const output = core.build(project);
  assert.equal(JSON.parse(output.get('audio.json')).hit_bindings[0].animation, 'attack_1');
  project.audio.hit_bindings.push({...project.audio.hit_bindings[0]});
  assert.throws(() => core.build(project));
});
test('audio editor keeps both lists visible and independently scrollable', () => {
  assert.match(pluginSource, /class="vfx-audio-panel(?:"|\s)/);
  assert.match(pluginSource, /class="vfx-audio-panel\s+vfx-audio-hit-panel"/);
  assert.match(pluginSource, /class="vfx-audio-list"/);
  assert.match(pluginSource, /class="vfx-audio-hit-list"/);
  assert.doesNotMatch(pluginSource, /<details><summary>YSS 命中绑定/);
  assert.match(pluginSource, /vfx-audio-list[^\{]*\{[^}]*overflow-y:auto/);
  assert.match(pluginSource, /vfx-audio-hit-list[^\{]*\{[^}]*overflow-y:auto/);
  assert.match(pluginSource, /vfx-model-audio-row/);
  assert.match(pluginSource, /来自 YSM 当前模型的 <code>displayPath<\/code>/);
  assert.doesNotMatch(pluginSource, /datalist id="vfx_yss_model_ids"/);
});
