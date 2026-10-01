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
  const animationFile = [...output.keys()].find(file => file.startsWith(`animations/${project.packId}/`));
  const animation = read(animationFile).animations[entity.animations.main];
  const events = core.events(animation);
  assert.notEqual(events[0].effect, events[1].effect);
  assert.equal(new Set(events.map(e => entity.particle_effects[e.effect])).size, 2);
  const identifiers = [...output].filter(([name]) => name.startsWith('particles/') || name.includes('/particles/')).map(([, buf]) => JSON.parse(buf).particle_effect.description.identifier);
  for (const event of events) assert.ok(identifiers.includes(entity.particle_effects[event.effect]));
  assert.equal(JSON.stringify(project.animations), original, 'export never rewrites source animations');
  core.saveSettings(project);
  assert.deepEqual(core.scan(project.root).effects[0].eventBindings, effect.eventBindings);
});
test('effects sharing one source geometry export one editable runtime geo', t => {
  const project = projectFixture(t);
  const first = project.effects[0];
  first.model = project.models[0].key;
  first.texture = project.textures[0].key;
  first.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map(event => [event.key, {
    alias: event.effect, particle: project.particles[0].key
  }]));
  const second = structuredClone(first);
  second.key = 'second'; second.name = 'second'; second.animation = project.animations[0].key;
  project.effects = [first, second];
  const output = core.build(project);
  const models = [...output.keys()].filter(file => file.startsWith('models/'));
  assert.equal(models.length, 1);
  const firstEntity = JSON.parse(output.get('entity/' + project.packId + '/' + first.name + '.json'));
  const secondEntity = JSON.parse(output.get('entity/' + project.packId + '/second.json'));
  assert.equal(firstEntity['minecraft:client_entity'].description.geometry.default,
    secondEntity['minecraft:client_entity'].description.geometry.default);
});
test('effects sharing one source geometry export one animation file with all entries', t => {
  const project = projectFixture(t);
  const source = project.models[0].key;
  const texture = project.textures[0].key;
  project.effects = project.animations.map((animation, index) => {
    const effect = {...core.makeEffect(project, animation, source), name: `effect_${index + 1}`, texture};
    effect.eventBindings = Object.fromEntries(core.events(animation.animation).map(event => [event.key, {alias: event.effect, particle: project.particles[0].key}]));
    return effect;
  });
  const output = core.build(project);
  const animations = [...output.keys()].filter(file => file.startsWith(`animations/${project.packId}/`));
  assert.equal(animations.length, 1);
  assert.equal(Object.keys(JSON.parse(output.get(animations[0])).animations).length, project.effects.length);
});
test('runtime asset names stay readable and only suffix real collisions', t => {
  const project = projectFixture(t);
  const effect = project.effects[0];
  effect.model = project.models[0].key;
  effect.texture = project.textures[0].key;
  effect.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map(event => [event.key, {alias: event.effect, particle: project.particles[0].key}]));
  project.effects = [effect];
  const output = core.build(project);
  const modelFiles = [...output.keys()].filter(file => file.startsWith('models/') || file.includes('/models/'));
  const animationFiles = [...output.keys()].filter(file => file.startsWith('animations/') || file.includes('/animations/'));
  assert.equal(modelFiles.length, 1);
  assert.equal(animationFiles.length, 1);
  assert.ok(!modelFiles[0].match(/[0-9a-f]{12}/i));
  assert.ok(!animationFiles[0].match(/[0-9a-f]{12}/i));
});
test('export resolves case, duplicate basenames, Chinese names and reserved empty texture without broken references', t => {
  const project = projectFixture(t);
  const bytes = fs.readFileSync(path.join(project.root, project.textures[0].path));
  project.textures = ['a/Spark.png', 'b/spark.png', 'c/spark_2.png', 'empty.png', '中文.png'].map(key => {
    const dest = path.join(project.root, key); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.writeFileSync(dest, bytes);
    return {key, path: key};
  });
  project.models = ['a/Test_Model.geo.json#0', 'b/test_model.geo.json#0', 'c/test_model_2.geo.json#0', '模型.geo.json#0'].map((key, index) => {
    const model = structuredClone(project.models[0]); model.key = key; model.path = key.split('#')[0];
    model.geometry.bones[0].pivot[0] = index;
    return model;
  });
  project.effects = project.textures.map((texture, index) => ({...core.makeEffect(project, null, project.models[index % 4].key), name: `effect_${index}`, texture: texture.key}));
  const particleEffect = {...core.makeEffect(project, project.animations[0]), name: 'particle_only'};
  particleEffect.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map((event, index) => [event.key, {alias: event.effect, particle: project.particles[index].key}]));
  project.particles.forEach(p => p.texture = project.textures[0].key);
  project.effects.push(particleEffect);
  const out = core.build(project), prefix = '';
  for (const name of ['test_model', 'test_model_2', 'test_model_3', 'model']) {
    assert.ok(out.has(`${prefix}models/${project.packId}/${name}.geo.json`));
  }
  for (const name of ['spark', 'spark_2', 'spark_3', 'empty_2', 'texture', 'empty']) {
    assert.ok(out.has(`${prefix}textures/${project.packId}/${name}.png`), name);
  }
  assert.ok(out.has(`${prefix}particles/${project.packId}/12.json`));
  assert.ok(out.has(`${prefix}particles/${project.packId}/12_2.json`));
  for (const [file, data] of out) if (file.startsWith('entity/') || file.includes('/entity/')) {
    const entity = JSON.parse(data)['minecraft:client_entity'].description;
    assert.ok(out.has(prefix + entity.textures.default.split(':')[1] + '.png'));
    for (const id of Object.values(entity.particle_effects)) {
      const particle = JSON.parse(out.get(`${prefix}particles/${id.split(':')[1]}.json`)).particle_effect;
      assert.equal(particle.description.identifier, id);
      assert.ok(out.has(prefix + particle.description.basic_render_parameters.texture.split(':')[1] + '.png'));
    }
  }
  project.effects.reverse(); project.models.reverse(); project.textures.reverse(); project.particles.reverse();
  const resources = output => [...output].filter(([file]) => file !== 'manifest.json').sort();
  assert.deepEqual(resources(core.build(project)), resources(out), 'list order does not change resource allocation');
});
test('exporting an imported runtime package retains readable names across repeated exports', t => {
  const project = projectFixture(t);
  const effect = project.effects[0]; project.effects = [effect];
  effect.model = project.models[0].key; effect.texture = project.textures[0].key;
  effect.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map((event, index) => [event.key, {alias: event.effect, particle: project.particles[index].key}]));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-readable-export-'));
  t.after(() => fs.rmSync(dest, {recursive: true, force: true}));
  const expected = [...core.build(project).keys()].sort();
  let current = project;
  for (let iteration = 0; iteration < 3; iteration++) {
    const result = core.exportPack(current, path.join(dest, String(iteration), 'packs'));
    current = core.scan(result.target);
    assert.deepEqual(core.validate(current), []);
    assert.deepEqual([...core.build(current).keys()].sort(), expected);
    assert.equal(current.models.length, 1);
  }
});
test('external asset sync removes legacy hash suffixes from filenames', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const source = path.join(external.root, 'particles', 'slash_abcdef123456.json');
  fs.copyFileSync(path.join(external.root, 'particles/12.json'), source);
  const plan = core.planAssetSync(project, {particles: [{source}]});
  assert.equal(plan.particles[0].target, 'particles/slash.json');
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
test('sync copies external particles with textures, preserves originals and reuses identical imports', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const source = path.join(external.root, 'particles/12.json');
  const original = fs.readFileSync(source);
  const input = {particles: [{source}], animations: [path.join(external.root, external.animations[0].path)]};
  const plan = core.planAssetSync(project, input);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.files.size, 1);
  assert.equal(plan.particles[0].target, 'particles/12_2.json');
  assert.equal(plan.particles[0].texture, 'textures/color.png');
  assert.equal(plan.animations[0].target, `animations/${path.basename(external.animations[0].path)}`);
  assert.ok(plan.rows.every(row => !row.target.includes('/imported/')));
  assert.equal(core.applyAssetSync(project, plan), 1);
  assert.deepEqual(fs.readFileSync(source), original);
  const copied = JSON.parse(fs.readFileSync(path.join(project.root, plan.particles[0].target)));
  assert.equal(copied.particle_effect.description.basic_render_parameters.texture + '.png', plan.particles[0].texture);
  assert.match(copied.particle_effect.description.identifier, /^yesstevevfx:[^/]+\/particles\//);
  assert.equal(core.planAssetSync(project, input).files.size, 0);
  const loaded = core.scan(project.root);
  assert.equal(loaded.particles.find(p => p.key === plan.particles[0].target).texture, plan.particles[0].texture);
  const effect = project.effects[0]; project.effects = [effect];
  effect.model = project.models[0].key; effect.texture = plan.particles[0].texture;
  effect.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map(e => [e.key, {alias: e.effect, particle: plan.particles[0].target}]));
  assert.ok(core.build(project).size > 0);
});
test('sync reports missing textures and supports an explicit PNG selection', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const source = path.join(external.root, 'particles/12.json');
  const doc = JSON.parse(fs.readFileSync(source));
  doc.particle_effect.description.basic_render_parameters.texture = 'textures/missing';
  fs.writeFileSync(source, JSON.stringify(doc));
  const plan = core.planAssetSync(project, {particles: [{source}]});
  assert.deepEqual(plan.missing, [source]);
  assert.throws(() => core.applyAssetSync(project, plan), /指定可用贴图/);
  const fixed = core.planAssetSync(project, {particles: [{source, texture: path.join(external.root, 'textures/color.png')}]});
  assert.equal(fixed.missing.length, 0);
  assert.equal(core.applyAssetSync(project, fixed), 1);
});
test('sync never overwrites colliding files or updates bindings on partial copy failure', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const input = {particles: [{source: path.join(external.root, 'particles/12.json')}]};
  const initial = core.planAssetSync(project, input);
  const target = initial.particles[0].target;
  fs.mkdirSync(path.dirname(path.join(project.root, target)), {recursive: true});
  const protectedContent = Buffer.from('{}');
  fs.writeFileSync(path.join(project.root, target), protectedContent);
  const plan = core.planAssetSync(project, input);
  assert.notEqual(plan.particles[0].target, target);
  assert.match(plan.particles[0].target, /^particles\/12_3\.json$/);
  const racingTarget = plan.particles[0].target;
  fs.writeFileSync(path.join(project.root, racingTarget), protectedContent);
  const before = JSON.stringify(core.settings(project));
  assert.throws(() => core.applyAssetSync(project, plan), /预览后发生变化/);
  assert.equal(JSON.stringify(core.settings(project)), before);
  assert.deepEqual(fs.readFileSync(path.join(project.root, target)), protectedContent);
  assert.ok(fs.existsSync(path.join(project.root, plan.particles[0].texture)), 'existing dependency remains intact');
});
test('sync keeps existing internal particle JSON and updates only its texture binding', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const source = path.join(project.root, project.particles[0].path);
  const before = fs.readFileSync(source);
  const plan = core.planAssetSync(project, {particles: [{source, texture: path.join(external.root, 'textures/color.png')}]});
  core.applyAssetSync(project, plan);
  assert.deepEqual(fs.readFileSync(source), before);
  assert.equal(core.scan(project.root).particles.find(p => p.path === project.particles[0].path).texture, plan.particles[0].texture);
});
test('sync uses edited texture bytes for particle dependencies and validates reused files', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const image = path.join(external.root, 'textures/color.png');
  const edited = Buffer.concat([fs.readFileSync(image), Buffer.from('edited fixture pixels')]);
  const input = {textures: [{id: 'painted', source: image, name: 'color.png', bytes: edited}],
    particles: [{source: path.join(external.root, 'particles/12.json')}]};
  const plan = core.planAssetSync(project, input);
  assert.equal(plan.particles[0].texture, plan.textures[0].target);
  core.applyAssetSync(project, plan);
  assert.deepEqual(fs.readFileSync(path.join(project.root, plan.textures[0].target)), edited);
  const reused = core.planAssetSync(project, input);
  fs.writeFileSync(path.join(project.root, reused.textures[0].target), 'changed after preview');
  assert.throws(() => core.applyAssetSync(project, reused), /复用文件在预览后发生变化/);
});
test('publishing in place completes the runtime graph without changing editable sources or duplicating scans', t => {
  const project = projectFixture(t), external = projectFixture(t);
  const backupRoot = core.editBackupRoot(project.root);
  t.after(() => {
    assert.equal(path.dirname(backupRoot), os.tmpdir());
    assert.ok(path.basename(backupRoot).startsWith('vfx-multimodel-') && backupRoot.endsWith('-edit-backups'));
    fs.rmSync(backupRoot, {recursive: true, force: true});
  });
  const source = path.join(external.root, 'particles/12.json');
  const particle = JSON.parse(fs.readFileSync(source)); particle.particle_effect.description.identifier = '';
  fs.writeFileSync(source, JSON.stringify(particle));
  const plan = core.planAssetSync(project, {particles: [{source}]}); core.applyAssetSync(project, plan);
  const effect = project.effects[0]; project.effects = [effect];
  effect.model = project.models[0].key; effect.texture = project.textures[0].key;
  effect.eventBindings = Object.fromEntries(core.events(project.animations[0].animation).map(e => [e.key, {alias: e.effect, particle: plan.particles[0].target}]));
  const modelBefore = fs.readFileSync(path.join(project.root, project.models[0].path));
  const animationBefore = fs.readFileSync(path.join(project.root, project.animations[0].path));
  const importedBefore = fs.readFileSync(path.join(project.root, plan.particles[0].target));
  const result = core.publishRuntime(project); assert.equal(result.effects, 1);
  const read = p => JSON.parse(fs.readFileSync(path.join(project.root, p)));
  const manifest = read('manifest.json'); assert.equal(manifest.effects.length, 1);
  const definition = read(manifest.effects[0]);
  const entity = read(definition.client_entity)['minecraft:client_entity'].description;
  const output = core.build(project, {generated: true});
  const animationDoc = [...output].find(([p]) => p.startsWith('animations/'));
  const animation = JSON.parse(animationDoc[1]).animations[entity.animations.main];
  for (const e of core.events(animation)) {
    const id = entity.particle_effects[e.effect]; assert.ok(id.startsWith('yesstevevfx:'));
    const doc = [...output].filter(([p]) => p.startsWith('particles/')).map(([,b]) => JSON.parse(b)).find(p => p.particle_effect.description.identifier === id);
    const tex = doc.particle_effect.description.basic_render_parameters.texture;
    assert.ok(fs.existsSync(path.join(project.root, tex.split(':')[1] + '.png')));
  }
  assert.deepEqual(fs.readFileSync(path.join(project.root, project.models[0].path)), modelBefore);
  assert.deepEqual(fs.readFileSync(path.join(project.root, project.animations[0].path)), animationBefore);
  assert.deepEqual(fs.readFileSync(path.join(project.root, plan.particles[0].target)), importedBefore);
  const rescanned = core.scan(project.root);
  assert.equal(rescanned.models.length, project.models.length);
  assert.equal(rescanned.animations.length, project.animations.length);
  assert.equal(rescanned.particles.length, project.particles.length);
  assert.ok(!rescanned.effects.some(e => e.animation.includes('vfx_generated')));
  assert.equal(core.publishRuntime(project).count, 0);
  effect.eventBindings['0#0'].particle = 'missing.json';
  assert.throws(() => core.publishRuntime(project), /粒子/);
  assert.deepEqual(read('manifest.json'), manifest, 'invalid saves do not publish a partial manifest');
});
test('runtime-pack edit backups live outside the packs directory', () => {
  const root = path.join(os.tmpdir(), 'client', 'config', 'yesstevevfx', 'packs', 'test_effects');
  assert.equal(core.editBackupRoot(root), path.join(os.tmpdir(), 'client', 'config', 'yesstevevfx', 'vfx-edit-backups', 'test_effects'));
});
test('publishing retires obsolete generated names with backups but preserves editable sources', t => {
  const project = projectFixture(t);
  const effect = project.effects[1]; project.effects = [effect];
  effect.model = project.models[0].key; effect.texture = project.textures[0].key;
  const backupRoot = core.editBackupRoot(project.root);
  t.after(() => fs.rmSync(backupRoot, {recursive: true, force: true}));
  const old = `animations/vfx_generated/${project.packId}/old_abcdef123456.animation.json`;
  const oldBytes = Buffer.from('{"animations":{}}');
  fs.mkdirSync(path.dirname(path.join(project.root, old)), {recursive: true});
  fs.writeFileSync(path.join(project.root, old), oldBytes);
  const source = project.animations[1].path, before = fs.readFileSync(path.join(project.root, source));
  const result = core.publishRuntime(project);
  assert.equal(fs.existsSync(path.join(project.root, old)), false);
  assert.deepEqual(fs.readFileSync(path.join(result.backup, old)), oldBytes);
  assert.deepEqual(fs.readFileSync(path.join(project.root, source)), before);
  assert.equal(core.publishRuntime(project).count, 0);
});
test('recent workflow paths survive lookup and fall back when a folder is removed', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-recent-'));
  const pack = path.join(parent, '中文特效包');
  fs.mkdirSync(pack);
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  assert.equal(core.rememberPath('test_recent_path', pack), path.resolve(pack));
  assert.equal(core.recentPath('test_recent_path'), path.resolve(pack));
  fs.rmSync(pack, {recursive: true});
  assert.equal(core.recentPath('test_recent_path'), path.resolve(parent));
});
test('YSM Molang uses the pack and effect IDs', () => {
  assert.equal(core.molang({packId: 'demo_pack'}, {name: 'slash'}),
    "ctrl.vfx_play('demo_pack:slash', 'main');");
  assert.equal(core.molang({packId: '中文包'}, {name: 'slash'}, 'skill_1'),
    "ctrl.vfx_play('中文包:slash', 'skill_1');");
});
test('new pack creates editable geo and animation sources with a preview binding', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-new-pack-'));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const root = core.createEmptyPack(parent, {packId: 'demo_pack', displayName: '演示包', modelFile: '女漂.geo', animationFile: '攻击.animation.json'});
  assert.ok(fs.existsSync(path.join(root, 'models/女漂.geo.json')));
  assert.ok(fs.existsSync(path.join(root, 'animations/攻击.animation.json')));
  assert.ok(!fs.existsSync(path.join(root, 'models/女漂.geo.geo.json')));
  const project = core.scan(root);
  assert.equal(project.models.length, 1);
  assert.equal(project.models[0].id, 'geometry.demo_pack.model');
  assert.equal(project.animations.length, 1);
  assert.equal(project.animations[0].id, 'animation.demo_pack.main');
  assert.equal(project.effects.length, 1);
  assert.equal(project.effects[0].model, 'models/女漂.geo.json#0');
  assert.equal(project.effects[0].animation, 'animations/攻击.animation.json#animation.demo_pack.main');
});
test('runtime publish can clear the manifest after deleting the last effect', t => {
  const project = projectFixture(t);
  project.effects = [];
  const result = core.publishRuntime(project);
  assert.equal(result.effects, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(project.root, 'manifest.json')));
  assert.deepEqual(manifest.effects, []);
});
test('export rejects box UV outside the declared canvas before writing a runtime pack', t => {
  const project = projectFixture(t), effect = project.effects[1];
  project.effects = [effect]; effect.model = project.models[0].key; effect.texture = project.textures[0].key;
  const geometry = project.models[0].geometry;
  geometry.description.texture_width = 1; geometry.description.texture_height = 1;
  const before = JSON.stringify(geometry);
  assert.throws(() => core.build(project), /方盒 UV.*1×1/);
  assert.throws(() => core.publishRuntime(project), /方盒 UV/);
  assert.ok(!fs.existsSync(path.join(project.root, 'manifest.json')));
  assert.equal(JSON.stringify(geometry), before, 'do not guess dimensions or mutate UVs');
  geometry.description.texture_width = 16; geometry.description.texture_height = 16;
  assert.ok(core.build(project).size > 0, 'a valid logical canvas may differ from PNG size');
  geometry.bones[0].cubes[0].uv[0] = -1;
  assert.throws(() => core.build(project), /方盒 UV/);
});
test('new editable models support explicit UV dimensions instead of the carrier placeholder', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-uv-size-'));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const root = core.createEmptyPack(parent, {packId: 'uv_pack', textureWidth: 2048, textureHeight: 1024});
  const desc = core.scan(root).models[0].geometry.description;
  assert.equal(desc.texture_width, 2048); assert.equal(desc.texture_height, 1024);
  const defaults = core.scan(core.createEmptyPack(parent, {packId: 'defaults'})).models[0].geometry.description;
  assert.equal(defaults.texture_width, 16); assert.equal(defaults.texture_height, 16);
  assert.throws(() => core.createEmptyPack(parent, {packId: 'bad', textureWidth: 0}), /UV 尺寸/);
  assert.ok(!fs.existsSync(path.join(parent, 'bad')));
});
test('automatic import dimensions come only from an empty Bedrock model merge', () => {
  const model = {meta: {model_format: 'bedrock'}, resolution: {width: 2048, height: 1024}, elements: [{type: 'cube'}], textures: [{width: 4096, height: 4096}]};
  assert.deepEqual(core.importedUvSize(model, false), {width: 2048, height: 1024});
  assert.equal(core.importedUvSize(model, true), null, 'existing geometry must not be remapped');
  assert.equal(core.importedUvSize({...model, meta: {model_format: 'free'}}, false), null);
  assert.equal(core.importedUvSize({...model, resolution: undefined}, false), null, 'PNG dimensions are not a fallback');
  assert.equal(core.importedUvSize({...model, resolution: {width: 0, height: 16}}, false), null);
  assert.equal(core.importedUvSize({...model, elements: [{type: 'mesh'}]}, false), null);
  assert.equal(core.importedUvSize({...model, elements: []}, false), null);
});
test('import UV restoration handles mixed UV and non-square canvases without changing box UVs', () => {
  const face = {uv: [1, 2, -3, 4]}, box = {box_uv: true, uv_offset: [123, 456], faces: {north: {uv: [9, 8, 7, 6]}}};
  const cubes = [{box_uv: false, faces: {north: face}}, box], before = JSON.stringify(cubes);
  const changes = core.planImportedUv(cubes, {width: 16, height: 16}, {width: 2048, height: 1024});
  assert.equal(JSON.stringify(cubes), before, 'planning is read-only until the undo transaction starts');
  assert.equal(changes.length, 1); assert.equal(changes[0].face, face);
  assert.deepEqual(changes[0].uv, [128, 128, -384, 256]);
  assert.deepEqual(core.planImportedUv(cubes, {width: 2048, height: 1024}, {width: 2048, height: 1024})[0].uv, face.uv);
  assert.throws(() => core.planImportedUv(cubes, {width: 0, height: 16}, {width: 2048, height: 1024}), /尺寸无效/);
  assert.throws(() => core.planImportedUv([{faces: {north: {uv: [NaN, 0, 1, 1]}}}], {width: 16, height: 16}, {width: 16, height: 16}), /坐标无效/);
});
