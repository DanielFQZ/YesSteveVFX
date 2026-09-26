const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../yesstevevfx_studio');

const {fixture} = require('./fixture');
function projectFixture(t) {
  const root = fixture();
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('vfx-multimodel-'));
    fs.rmSync(root, {recursive: true});
  });
  return core.scan(root);
}
test('multiple geometry candidates require explicit model binding', t => {
  const project = projectFixture(t);
  assert.equal(project.models.length, 3);
  assert.equal(project.animations.length, 3);
  assert.ok(project.effects.every(e => e.modelUnresolved && !e.model));
  assert.ok(core.validate(project).every(e => e.includes('模型关系未确认')));
  const [first, second] = project.models;
  project.effects[0].model = first.key;
  project.effects[1].model = second.key;
  const views = core.modelViews(project);
  assert.equal(views[0].files[0].count, 3);
  assert.equal(views[1].files[0].count, 3);
  assert.equal(views[2].effects.length, 0);
});
test('duplicate numeric aliases and particle identifiers export distinct correct references', t => {
  const project = projectFixture(t);
  const effect = project.effects[0];
  project.effects = [effect];
  effect.model = project.models[0].key;
  effect.texture = project.textures[0].key;
  effect.eventBindings = {'0#0': {alias: '12', particle: project.particles[0].key}, '0#1': {alias: '12', particle: project.particles[1].key}};
  const original = JSON.stringify(project.animations);
  const output = core.build(project);
  const read = file => JSON.parse(output.get(file));
  const definition = read(`effects/${effect.name}.json`);
  const entity = read(definition.client_entity)['minecraft:client_entity'].description;
  const animation = read(`assets/eyelib/animations/${project.packId}/${effect.name}.animation.json`).animations[entity.animations.main];
  const events = core.events(animation);
  assert.notEqual(events[0].effect, events[1].effect);
  assert.equal(new Set(events.map(e => entity.particle_effects[e.effect])).size, 2);
  const identifiers = [...output].filter(([name]) => name.includes('/particles/')).map(([, buf]) => JSON.parse(buf).particle_effect.description.identifier);
  for (const event of events) assert.ok(identifiers.includes(entity.particle_effects[event.effect]));
  assert.equal(JSON.stringify(project.animations), original, 'export never rewrites source animations');
  core.saveSettings(project);
  assert.deepEqual(core.scan(project.root).effects[0].eventBindings, effect.eventBindings);
});
test('saving native particle files resolves same-name events and rejects outside files', t => {
  const project = projectFixture(t);
  const compiled = structuredClone(project.animations[0].animation);
  const points = project.particles.map((p, i) => ({key: `0#${i}`, file: path.join(project.root, p.path)}));
  const bindings = core.captureBindings(project, project.effects[0], compiled, points);
  assert.notEqual(bindings['0#0'].alias, bindings['0#1'].alias);
  assert.deepEqual(core.events(compiled).map(e => e.effect), Object.values(bindings).map(b => b.alias));
  assert.throws(() => core.captureBindings(project, null, compiled, [{key: '0#0', file: path.join(os.tmpdir(), 'unowned.json')}]), /粒子文件不在工程内/);
});
test('version 1 bindings migrate; explicitly unbound events do not fall back', t => {
  const project = projectFixture(t);
  const effect = project.effects[0];
  effect.bindings = {'12': project.particles[0].key};
  delete effect.eventBindings;
  const config = core.settings(project); config.version = 1;
  fs.writeFileSync(path.join(project.root, 'vfx-project.json'), JSON.stringify(config));
  const rescanned = core.scan(project.root);
  const migrated = rescanned.effects[0];
  assert.equal(migrated.eventBindings['0#0'].particle, project.particles[0].key);
  migrated.eventBindings['0#0'].particle = '';
  assert.equal(core.eventParticle(rescanned, migrated, core.events(project.animations[0].animation)[0]), '');
});

