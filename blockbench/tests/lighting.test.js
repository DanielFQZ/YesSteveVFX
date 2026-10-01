const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../yesstevevfx_studio');
const {fixture} = require('./fixture');
const lightingKey = 'minecraft:particle_appearance_lighting';

function setup(t) {
  const root = fixture();
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = core.scan(root), effect = project.effects[0];
  project.effects.slice(1).forEach(other => other.enabled = false);
  effect.model = project.models[0].key; effect.texture = project.textures[0].key;
  effect.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map((e, i) => [e.key, {alias: e.effect, particle: project.particles[i].key}]));
  return project;
}
function outputDocuments(output, type) {
  return [...output].filter(([name]) => name.startsWith(type + '/')).map(([, bytes]) => JSON.parse(bytes));
}
function writeOutput(root, output) {
  for (const [file, bytes] of output) {
    const dest = path.join(root, file);
    fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.writeFileSync(dest, bytes);
  }
}
test('lighting export preserves defaults, supports both overrides and never changes source particles', t => {
  const project = setup(t), [a, b] = project.particles;
  a.json.particle_effect.components[lightingKey] = {};
  delete b.json.particle_effect.components[lightingKey];
  const before = JSON.stringify(project.particles.map(p => p.json));
  const source = outputDocuments(core.build(project), 'particles');
  assert.deepEqual(source.map(p => Object.hasOwn(p.particle_effect.components, lightingKey)), [true, false]);
  a.lighting = 'unlit'; b.lighting = 'ambient'; project.effects[0].ignoreLighting = true;
  const output = core.build(project);
  assert.deepEqual(outputDocuments(output, 'particles').map(p => Object.hasOwn(p.particle_effect.components, lightingKey)), [false, true]);
  assert.equal(Object.values(outputDocuments(output, 'render_controllers')[0].render_controllers)[0].ignore_lighting, true);
  assert.equal(JSON.stringify(project.particles.map(p => p.json)), before);
  a.lighting = 'source'; b.lighting = 'source'; project.effects[0].ignoreLighting = false;
  const restored = core.build(project);
  assert.deepEqual(outputDocuments(restored, 'particles').map(p => Object.hasOwn(p.particle_effect.components, lightingKey)), [true, false]);
  assert.equal(Object.values(outputDocuments(restored, 'render_controllers')[0].render_controllers)[0].ignore_lighting, false);
});
test('lighting survives settings, rescan and exported-pack import without editor metadata', t => {
  const project = setup(t);
  project.effects[0].ignoreLighting = true; project.particles[0].lighting = 'unlit'; project.particles[1].lighting = 'ambient';
  core.saveSettings(project);
  const rescanned = core.scan(project.root);
  assert.equal(rescanned.effects[0].ignoreLighting, true);
  assert.deepEqual(rescanned.particles.map(p => p.lighting), ['unlit', 'ambient']);
  const output = core.build(rescanned), exported = path.join(project.root, 'export');
  writeOutput(exported, output);
  assert.ok(!fs.existsSync(path.join(exported, 'vfx-project.json')));
  const imported = core.scan(exported);
  assert.equal(imported.effects[0].ignoreLighting, true);
  assert.deepEqual(imported.particles.map(p => Object.hasOwn(p.json.particle_effect.components, lightingKey)).sort(), [false, true]);
  assert.ok(imported.particles.every(p => p.lighting === 'source'));
  const rebuilt = core.build(imported);
  assert.equal(Object.values(outputDocuments(rebuilt, 'render_controllers')[0].render_controllers)[0].ignore_lighting, true);
  assert.deepEqual(outputDocuments(rebuilt, 'particles').map(p => Object.hasOwn(p.particle_effect.components, lightingKey)).sort(), [false, true]);
});
test('shared geometry may have independent model lighting while particle settings stay shared', t => {
  const project = setup(t), first = project.effects[0];
  project.effects.push({...structuredClone(first), key: 'second', name: 'second', ignoreLighting: true});
  project.particles[0].lighting = 'unlit';
  const output = core.build(project);
  assert.equal(outputDocuments(output, 'models').length, 1);
  assert.equal(outputDocuments(output, 'particles').length, 2);
  assert.deepEqual(outputDocuments(output, 'render_controllers').map(d => Object.values(d.render_controllers)[0].ignore_lighting), [false, true]);
  first.ignoreLighting = 'true'; assert.throws(() => core.build(project), /模型全亮必须为布尔值/);
  first.ignoreLighting = false; project.particles[0].lighting = 'invalid'; assert.throws(() => core.build(project), /未知粒子光照模式/);
});
test('syncing an existing particle preserves its selected lighting override', t => {
  const project = setup(t), particle = project.particles[0]; particle.lighting = 'unlit';
  const plan = core.planAssetSync(project, {particles: [{source: path.join(project.root, particle.path), texture: path.join(project.root, particle.texture)}]});
  core.applyAssetSync(project, plan);
  assert.equal(project.particles.find(p => p.key === particle.key).lighting, 'unlit');
  assert.equal(core.scan(project.root).particles.find(p => p.key === particle.key).lighting, 'unlit');
});
