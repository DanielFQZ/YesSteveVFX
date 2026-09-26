/* YesSteveVFX Studio — standalone Blockbench desktop plugin. */
(() => {
  'use strict';
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const clone = value => JSON.parse(JSON.stringify(value));
  const slash = value => value.replaceAll('\\', '/');
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  const token = value => `${path.basename(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 28) || 'asset'}_${hash(value)}`;
  const previewIdentifier = value => `yesstevevfx:preview/${token(value)}`;
  const uniqueMatch = items => items.length === 1 ? items[0] : null;
  const relative = (root, file) => slash(path.relative(root, file));
  function inside(root, child) {
    const rel = path.relative(path.resolve(root), path.resolve(child));
    return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  }
  function fileAt(root, rel) {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(p => p === '..' || p === '.' || !p)) {
      throw new Error(`非法相对路径：${rel}`);
    }
    const result = path.resolve(root, rel);
    if (!inside(root, result)) throw new Error(`路径越过工程目录：${rel}`);
    return result;
  }
  function filesIn(root) {
    const files = [];
    let bytes = 0;
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`不支持链接文件：${absolute}`);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile()) {
          const size = fs.statSync(absolute).size;
          bytes += size;
          if (size > 16 * 1024 * 1024 || bytes > 128 * 1024 * 1024 || files.length >= 4096) throw new Error('工程超过 VFX 的资源大小限制');
          files.push(relative(root, absolute));
        }
      }
    }
    walk(root);
    return files.sort();
  }
  function events(animation) {
    // BB serializes integer timestamps as "0.0" but live keyframes use 0.
    // Canonicalize only the binding key; retain the original JSON time for writes.
    return Object.entries(animation?.particle_effects || {}).flatMap(([time, value]) =>
      (Array.isArray(value) ? value : [value]).map((event, index) => ({
        time, index, key: `${Number(time)}#${index}`, effect: typeof event === 'string' ? event : event.effect,
        locator: typeof event === 'object' ? event.locator || '' : ''
      })));
  }
  function textureMatch(reference, textures) {
    if (!reference) return '';
    const stem = value => slash(value).replace(/^[^:]+:/, '').replace(/\.png$/i, '').toLowerCase();
    const wanted = stem(reference);
    const exact = uniqueMatch(textures.filter(t => stem(t.path).replace(/^assets\/eyelib\//, '') === wanted));
    if (exact) return exact.key;
    const basename = path.posix.basename(wanted);
    return uniqueMatch(textures.filter(t => path.posix.basename(stem(t.path)) === basename))?.key || '';
  }
  function scan(root) {
    root = path.resolve(root);
    const project = {version: 1, root, packId: path.basename(root).toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 64) || 'vfx_pack', displayName: path.basename(root),
      assets: [], models: [], animations: [], particles: [], textures: [], effects: [], warnings: []};
    const documents = new Map();
    for (const rel of filesIn(root)) {
      if (rel === 'vfx-project.json' || (fs.existsSync(path.join(root, 'vfx-project.json')) && /^(assets\/eyelib\/[^/]+|effects)\/vfx_generated\//.test(rel))) continue;
      const asset = {path: rel, type: '其他'};
      project.assets.push(asset);
      if (/\.png$/i.test(rel)) { project.textures.push({key: rel, path: rel}); asset.type = '贴图'; continue; }
      if (!/\.json$/i.test(rel)) continue;
      let json;
      try { json = readJson(fileAt(root, rel)); }
      catch (error) { throw new Error(`${rel}：JSON 解析失败：${error.message}`); }
      documents.set(rel, json);
      if (Array.isArray(json['minecraft:geometry'])) {
        asset.type = '模型';
        json['minecraft:geometry'].forEach((geometry, index) => project.models.push({key: `${rel}#${index}`, path: rel, index, id: geometry.description?.identifier || '', geometry}));
      } else if (json.animations) {
        asset.type = '动画';
        for (const [id, animation] of Object.entries(json.animations)) project.animations.push({key: `${rel}#${id}`, path: rel, id, animation});
      } else if (json.particle_effect) {
        asset.type = '粒子';
        project.particles.push({key: rel, path: rel, id: json.particle_effect.description?.identifier || '', json, texture: ''});
      } else if (json['minecraft:client_entity']) asset.type = '实体绑定';
      else if (json.render_controllers) asset.type = '渲染控制器';
      else if (json.animation_controllers) { asset.type = '动画控制器'; project.warnings.push(`${rel}：第一版仅导出直接播放的动画，不执行动画控制器。`); }
    }
    for (const particle of project.particles) {
      particle.texture = textureMatch(particle.json.particle_effect.description?.basic_render_parameters?.texture, project.textures);
      if (project.particles.filter(p => p.id && p.id === particle.id).length > 1) project.warnings.push(`${particle.path}：原粒子 ID 重复，不能自动恢复实体里的引用，请手动绑定事件。`);
    }
    const manifest = documents.get('manifest.json');
    if (manifest) { project.packId = manifest.pack_id; project.displayName = manifest.display_name || manifest.pack_id; }
    const used = new Set();
    function addEffect(animation, definition, entity) {
      let name = definition?.id?.split(':').pop() || animation?.id?.split('.').pop() || 'effect';
      name = name.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
      if (!/[a-z0-9]/.test(name)) name = `effect_${project.effects.length + 1}`;
      const base = name; let index = 2;
      while (used.has(name)) name = `${base}_${index++}`;
      used.add(name);
      const geometryId = entity?.geometry?.default || Object.values(entity?.geometry || {})[0];
      const model = geometryId ? uniqueMatch(project.models.filter(m => m.id === geometryId)) : uniqueMatch(project.models);
      if (geometryId && !model) project.warnings.push(`模型引用无法唯一解析：${geometryId}，请明确选择模型。`);
      if (!geometryId && project.models.length > 1) project.warnings.push(`${animation?.id || name}：有多个候选模型，请在模型选择窗口关联动画。`);
      const texture = textureMatch(entity?.textures?.default || Object.values(entity?.textures || {})[0], project.textures);
      const effect = {key: `effect_${project.effects.length + 1}`, enabled: true, name, animation: animation?.key || '', model: model?.key || '', texture,
        modelUnresolved: !model && (!!geometryId || project.models.length > 1), eventBindings: {}, duration: definition?.duration_ticks || Math.max(20, Math.ceil((animation?.animation?.animation_length || 5) * 20) + 20), bindings: {}};
      for (const event of events(animation?.animation)) {
        const ref = entity?.particle_effects?.[event.effect];
        const particle = uniqueMatch(project.particles.filter(p => ref ? p.id === ref :
          p.id === event.effect || path.posix.basename(p.path).replace(/(?:\.particle)?\.json$/i, '') === event.effect));
        effect.bindings[event.effect] = particle?.key || '';
      }
      project.effects.push(effect);
    }
    if (Array.isArray(manifest?.effects) && !fs.existsSync(path.join(root, 'vfx-project.json'))) {
      for (const rel of manifest.effects) {
        const definition = documents.get(rel);
        const entity = documents.get(definition?.client_entity)?.['minecraft:client_entity']?.description;
        if (!definition || !entity) throw new Error(`缺少 effect 或 client_entity：${rel}`);
        const ids = Object.values(entity.animations || {});
        const animation = uniqueMatch(project.animations.filter(a => ids.includes(a.id)));
        if (ids.length && !animation) project.warnings.push(`${rel}：动画关系不唯一，请重新选择动画。`);
        addEffect(animation, definition, entity);
      }
    } else {
      for (const animation of project.animations) addEffect(animation);
    }
    const particleTextures = new Set(project.particles.map(p => p.texture));
    const modelTexture = uniqueMatch(project.textures.filter(t => !particleTextures.has(t.key)));
    for (const effect of project.effects) if (!effect.texture) effect.texture = modelTexture?.key || '';
    const configPath = path.join(root, 'vfx-project.json');
    if (fs.existsSync(configPath)) {
      const config = readJson(configPath);
      if (![1, 2].includes(config.version)) throw new Error('不支持的 vfx-project.json 版本');
      project.packId = config.packId; project.displayName = config.displayName;
      project.effects = config.effects;
      for (const particle of project.particles) particle.texture = config.particleTextures?.[particle.key] || particle.texture;
      for (const animation of project.animations) if (!project.effects.some(e => e.animation === animation.key)) {
        const model = uniqueMatch(project.models);
        const effect = makeEffect(project, animation, model?.key || '');
        effect.modelUnresolved = project.models.length > 1;
        effect.texture = modelTexture?.key || '';
        project.effects.push(effect);
      }
    }
    for (const effect of project.effects) {
      effect.bindings ||= {};
      effect.eventBindings ||= {};
      // Version 1 had only alias bindings. Migrate only known file identities.
      const animation = project.animations.find(a => a.key === effect.animation);
      for (const event of events(animation?.animation)) {
        if (!effect.eventBindings[event.key] && effect.bindings[event.effect]) {
          effect.eventBindings[event.key] = {alias: event.effect, particle: effect.bindings[event.effect]};
        }
      }
    }
    return project;
  }
  const stableAlias = key => 'vfx_' + hash(key);
  function eventParticle(project, effect, event) {
    const bound = effect.eventBindings?.[event.key];
    // A moved/inserted keyframe must never inherit the old occupant's binding.
    if (bound && bound.alias === event.effect) return bound.particle;
    const explicit = effect.bindings?.[event.effect];
    if (explicit) return explicit;
    return uniqueMatch(project.particles.filter(p => stableAlias(p.key) === event.effect ||
      previewIdentifier(p.path) === event.effect || p.id === event.effect))?.key || '';
  }
  function setEventAlias(animation, event, alias) {
    const value = animation.particle_effects[event.time];
    const old = Array.isArray(value) ? value[event.index] : value;
    const replacement = typeof old === 'string' ? {effect: alias} : {...old, effect: alias};
    if (Array.isArray(value)) value[event.index] = replacement;
    else animation.particle_effects[event.time] = replacement;
  }
  function captureBindings(project, effect, compiled, points) {
    const resolved = events(compiled).map(event => {
      const point = points.find(p => p.key === event.key);
      const particle = point?.file ? project.particles.find(p => path.resolve(fileAt(project.root, p.path)) === path.resolve(point.file)) : null;
      if (point?.file && !particle) throw new Error(`粒子文件不在工程内：${point.file}。请使用 VFX → 同步外部资产到特效包。`);
      return {event, particle: particle?.key || (effect && eventParticle(project, effect, event))};
    });
    const bindings = {};
    for (const {event, particle} of resolved) {
      if (!particle) continue;
      const ambiguous = resolved.some(other => other.event.effect === event.effect && other.particle && other.particle !== particle);
      const alias = !event.effect || event.effect.startsWith('yesstevevfx:preview/') || ambiguous ? stableAlias(particle) : event.effect;
      setEventAlias(compiled, event, alias);
      bindings[event.key] = {alias, particle};
    }
    return bindings;
  }
  function modelViews(project) {
    const views = project.models.map(model => {
      const effects = project.effects.filter(e => e.model === model.key);
      const filePaths = [...new Set(effects.map(e => project.animations.find(a => a.key === e.animation)?.path).filter(Boolean))];
      const animations = project.animations.filter(a => filePaths.includes(a.path));
      return {key: model.key, model, effects, filePaths, animations,
        files: filePaths.map(path => ({path, count: animations.filter(a => a.path === path).length})),
        particles: new Set(effects.flatMap(e => events(project.animations.find(a => a.key === e.animation)?.animation)
          .map(event => eventParticle(project, e, event)).filter(Boolean))).size,
        bones: model.geometry.bones?.length || 0,
        cubes: (model.geometry.bones || []).reduce((n, bone) => n + (bone.cubes?.length || 0), 0)};
    });
    const particleOnly = project.effects.filter(e => !e.model && !e.modelUnresolved);
    if (particleOnly.length) {
      const filePaths = [...new Set(particleOnly.map(e => project.animations.find(a => a.key === e.animation)?.path).filter(Boolean))];
      const animations = project.animations.filter(a => filePaths.includes(a.path));
      views.push({key: '', model: null, effects: particleOnly, files: filePaths.map(path => ({path, count: animations.filter(a => a.path === path).length})), animations, bones: 0, cubes: 0});
    }
    return views;
  }
  function makeEffect(project, animation, model = '') {
    const base = (animation?.id.split('.').pop() || 'effect').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
    let name = /^[a-z0-9]/.test(base) ? base.slice(0, 80) : 'effect';
    const stem = name;
    for (let n = 2; project.effects.some(e => e.name === name); n++) name = `${stem}_${n}`;
    return {key: crypto.randomUUID(), name, enabled: true, model, modelUnresolved: false, texture: '',
      animation: animation?.key || '', duration: Math.max(20, Math.ceil((animation?.animation.animation_length || 5) * 20) + 20),
      bindings: {}, eventBindings: {}};
  }
  function settings(project) {
    return {version: 2, packId: project.packId, displayName: project.displayName, effects: clone(project.effects),
      particleTextures: Object.fromEntries(project.particles.map(p => [p.key, p.texture]))};
  }
  function find(items, key, label) {
    const item = items.find(item => item.key === key);
    if (!item) throw new Error(`请选择${label}（${key || '未绑定'}）`);
    return item;
  }
  function validate(project, onlyEffect) {
    const errors = [];
    const names = new Set();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(project.packId)) errors.push('包 ID 必须是 1–64 位小写字母、数字、点、横线或下划线，并以字母/数字开头');
    const effects = onlyEffect ? [onlyEffect] : project.effects.filter(e => e.enabled);
    if (!effects.length) errors.push('至少启用一个特效');
    for (const effect of effects) {
      try {
        if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(effect.name)) throw new Error('特效名必须是合法 ASCII ID');
        if (names.has(effect.name)) throw new Error('特效名重复');
        names.add(effect.name);
        if (!Number.isInteger(Number(effect.duration)) || effect.duration < 1 || effect.duration > 72000) throw new Error('持续时间必须为 1–72000 tick');
        if (effect.modelUnresolved && !effect.model) throw new Error('模型关系未确认，请在模型与动画绑定中选择模型或明确设为仅粒子');
        const model = effect.model ? find(project.models, effect.model, '模型') : null;
        if (model) find(project.textures, effect.texture, '模型贴图');
        const animation = effect.animation ? find(project.animations, effect.animation, '动画') : null;
        const timeKeys = Object.keys(animation?.animation.particle_effects || {});
        if (timeKeys.some(t => !Number.isFinite(Number(t))) || new Set(timeKeys.map(Number)).size !== timeKeys.length) throw new Error('粒子事件时间非法或重复（例如同时存在 0 和 0.0），请在源动画中合并该时间点');
        const locators = new Set((model?.geometry.bones || []).flatMap(bone => Object.keys(bone.locators || {})));
        for (const event of events(animation?.animation)) {
          const particle = find(project.particles, eventParticle(project, effect, event), `事件“${event.effect}”的粒子`);
          find(project.textures, particle.texture, `${particle.path} 的贴图`);
          if (event.locator && !locators.has(event.locator)) throw new Error(`事件 ${event.effect} 引用了不存在的定位器 ${event.locator}`);
          if (particle.json.particle_effect.events && JSON.stringify(particle.json.particle_effect.events).includes('"particle_effect"')) throw new Error(`${particle.path} 包含子粒子事件，第一版暂不支持自动绑定子粒子`);
        }
        if (!model && !events(animation?.animation).length) throw new Error('没有模型，也没有粒子事件');
        if (animation?.animation.sound_effects) throw new Error('第一版暂不导出声音事件，请移除或拆分到独立动画');
      } catch (error) { errors.push(`${effect.name}：${error.message}`); }
    }
    return errors;
  }
  const emptyGeometry = () => ({description: {identifier: 'geometry.vfx_preview', texture_width: 1, texture_height: 1}, bones: [{name: 'root', pivot: [0, 0, 0]}]});
  function build(project, options = {}) {
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    const out = new Map();
    const json = (name, content) => out.set(name, Buffer.from(JSON.stringify(content, null, 2) + '\n'));
    const pack = project.packId;
    const resourcePack = options.generated ? `vfx_generated/${pack}` : pack;
    const textureId = key => `yesstevevfx:textures/${resourcePack}/${token(key)}`;
    const particleId = key => `yesstevevfx:${resourcePack}/${token(key)}`;
    function putTexture(key) {
      const texture = find(project.textures, key, '贴图');
      out.set(`assets/eyelib/textures/${resourcePack}/${token(key)}.png`, fs.readFileSync(fileAt(project.root, texture.path)));
      return textureId(key);
    }
    const effectPaths = [];
    for (const effect of project.effects.filter(e => e.enabled)) {
      const base = `${options.generated ? 'vfx_generated.' : ''}${pack}.${effect.name}`;
      const geometry = effect.model ? clone(find(project.models, effect.model, '模型').geometry) : emptyGeometry();
      geometry.description.identifier = `geometry.yesstevevfx.${base}`;
      json(`assets/eyelib/models/${resourcePack}/${effect.name}.geo.json`, {format_version: '1.12.0', 'minecraft:geometry': [geometry]});
      const entity = {identifier: `yesstevevfx:${resourcePack}/${effect.name}`, materials: {default: 'entity_alphatest'},
        geometry: {default: geometry.description.identifier}, textures: {}, particle_effects: {},
        render_controllers: [`controller.render.yesstevevfx.${base}`]};
      if (effect.model) entity.textures.default = putTexture(effect.texture);
      else {
        const key = `textures/${resourcePack}/empty`;
        entity.textures.default = `yesstevevfx:${key}`;
        out.set(`assets/eyelib/${key}.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
      }
      if (effect.animation) {
        const animation = clone(find(project.animations, effect.animation, '动画').animation);
        for (const event of events(animation)) {
          const particle = find(project.particles, eventParticle(project, effect, event), '粒子');
          const alias = stableAlias(particle.key);
          setEventAlias(animation, event, alias);
          entity.particle_effects[alias] = particleId(particle.key);
          const doc = clone(particle.json);
          doc.particle_effect.description.identifier = particleId(particle.key);
          doc.particle_effect.description.basic_render_parameters.texture = putTexture(particle.texture);
          json(`assets/eyelib/particles/${resourcePack}/${token(particle.key)}.json`, doc);
        }
        const id = `animation.yesstevevfx.${base}`;
        entity.animations = {main: id}; entity.scripts = {animate: ['main']};
        json(`assets/eyelib/animations/${resourcePack}/${effect.name}.animation.json`, {format_version: '1.8.0', animations: {[id]: animation}});
      }
      const entityPath = `assets/eyelib/entity/${resourcePack}/${effect.name}.json`;
      json(entityPath, {'minecraft:client_entity': {description: entity}});
      json(`assets/eyelib/render_controllers/${resourcePack}/${effect.name}.json`, {render_controllers: {
        [entity.render_controllers[0]]: {geometry: 'Geometry.default', materials: ['Material.default'], textures: ['Texture.default']}
      }});
      const effectPath = `effects/${options.generated ? 'vfx_generated/' : ''}${effect.name}.json`;
      effectPaths.push(effectPath);
      json(effectPath, {format_version: 1, id: `${pack}:${effect.name}`, duration_ticks: Number(effect.duration), client_entity: entityPath});
    }
    json('manifest.json', {format_version: 1, pack_id: pack, display_name: project.displayName || pack, effects: effectPaths});
    if (out.size > 4096 || [...out.values()].reduce((n, b) => n + b.length, 0) > 128 * 1024 * 1024) throw new Error('导出包超过 VFX 的资源大小限制');
    for (const [name, bytes] of out) {
      if (!/^[a-z0-9._/-]+$/.test(name) || bytes.length > 16 * 1024 * 1024) throw new Error(`导出资源路径或大小不合法：${name}`);
    }
    return out;
  }
  function editBackupRoot(root) {
    const parent = path.dirname(path.resolve(root));
    return path.basename(parent).toLowerCase() === 'packs'
      ? path.join(path.dirname(parent), 'vfx-edit-backups', path.basename(root))
      : path.join(parent, `${path.basename(root)}-edit-backups`);
  }
  function publishRuntime(project) {
    // Keep editable sources and their BB paths intact. The manifest points at
    // generated resources with distinct IDs, so old source assets cannot shadow them.
    const output = build(project, {generated: true});
    const sources = new Set([...project.models, ...project.animations, ...project.particles, ...project.textures].map(a => a.path));
    for (const file of output.keys()) if (sources.has(file)) throw new Error('生成目录被当作源资产使用，请先调整源路径：' + file);
    output.set('vfx-project.json', Buffer.from(JSON.stringify(settings(project), null, 2) + '\n'));
    const all = new Map(filesIn(project.root).map(file => [file, fs.statSync(fileAt(project.root, file)).size]));
    for (const [file, bytes] of output) all.set(file, bytes.length);
    if (all.size > 4096 || [...all.values()].reduce((a, b) => a + b, 0) > 128 * 1024 * 1024) throw new Error('生成后特效包会超过资源大小限制');
    const changed = [...output].filter(([file, bytes]) => !fs.existsSync(fileAt(project.root, file)) || !fs.readFileSync(fileAt(project.root, file)).equals(bytes));
    // Switch the manifest only after every dependency is in place.
    changed.sort(([a], [b]) => Number(a === 'manifest.json') - Number(b === 'manifest.json'));
    const backup = path.join(editBackupRoot(project.root), `runtime-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    const previous = new Map();
    for (const [file] of changed) {
      const dest = fileAt(project.root, file);
      previous.set(file, fs.existsSync(dest) ? fs.readFileSync(dest) : null);
      if (previous.get(file)) {
        const old = fileAt(backup, file); fs.mkdirSync(path.dirname(old), {recursive: true}); fs.writeFileSync(old, previous.get(file));
      }
    }
    const written = [];
    try {
      for (const [file, bytes] of changed) {
        const dest = fileAt(project.root, file);
        fs.mkdirSync(path.dirname(dest), {recursive: true}); written.push(file); fs.writeFileSync(dest, bytes);
      }
    } catch (error) {
      for (const file of written.reverse()) {
        const dest = fileAt(project.root, file), old = previous.get(file);
        if (old) fs.writeFileSync(dest, old); else if (fs.existsSync(dest)) fs.unlinkSync(dest);
      }
      throw error;
    }
    return {count: changed.length, effects: project.effects.filter(e => e.enabled).length, backup: changed.length ? backup : ''};
  }
  function saveSettings(project) {
    const dest = path.join(project.root, 'vfx-project.json');
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings(project), null, 2) + '\n');
    fs.renameSync(tmp, dest);
  }
  function createEmptyPack(parent, options = {}) {
    parent = path.resolve(parent);
    const packId = String(options.packId || '').trim().toLowerCase();
    const displayName = String(options.displayName || packId).trim() || packId;
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(packId)) {
      throw new Error('包 ID 必须是 1–64 位小写字母、数字、点、横线或下划线，并以字母/数字开头。中文可填写在显示名称中。');
    }
    const root = path.join(parent, packId);
    if (fs.existsSync(root)) throw new Error(`目标目录已存在：${root}`);
    fs.mkdirSync(root, {recursive: true});
    for (const dir of ['effects', 'assets/eyelib/models', 'assets/eyelib/animations',
      'assets/eyelib/particles', 'assets/eyelib/entity', 'assets/eyelib/render_controllers',
      'assets/eyelib/textures']) fs.mkdirSync(path.join(root, dir), {recursive: true});
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      format_version: 1, pack_id: packId, display_name: displayName, effects: []
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'vfx-project.json'), JSON.stringify({
      version: 1, packId, displayName, effects: [], particleTextures: {}
    }, null, 2) + '\n');
    return root;
  }
  function exportPack(project, packsRoot) {
    const output = build(project);
    packsRoot = path.resolve(packsRoot);
    const target = path.join(packsRoot, project.packId);
    // Never replace the source project or a parent of it.
    if (inside(target, project.root) || inside(project.root, target)) throw new Error('导出目录与源工程重叠，请选择独立的客户端或导出目录');
    const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const staging = path.join(path.dirname(packsRoot), `.vfx-staging-${stamp}`);
    const backup = path.join(path.dirname(packsRoot), 'vfx-backups', `${project.packId}-${stamp}`);
    fs.mkdirSync(staging, {recursive: true});
    for (const [rel, bytes] of output) {
      const absolute = fileAt(staging, rel);
      fs.mkdirSync(path.dirname(absolute), {recursive: true}); fs.writeFileSync(absolute, bytes);
    }
    fs.mkdirSync(packsRoot, {recursive: true});
    let backedUp = false;
    try {
      if (fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.renameSync(target, backup); backedUp = true;
      }
      fs.renameSync(staging, target);
    } catch (error) {
      if (backedUp && !fs.existsSync(target)) fs.renameSync(backup, target);
      throw error;
    }
    return {target, backup: backedUp ? backup : '', count: output.size};
  }
  function particleTextureFile(source, json, explicit) {
    const exists = file => file && fs.existsSync(file) && fs.statSync(file).isFile();
    if (explicit) return exists(explicit) ? path.resolve(explicit) : '';
    const ref = json.particle_effect?.description?.basic_render_parameters?.texture;
    if (typeof ref !== 'string' || !ref) return '';
    if (path.isAbsolute(ref)) return exists(ref) ? path.resolve(ref) : '';
    const rel = ref.replace(/^[a-z0-9_.-]+:/i, '').replace(/\.png$/i, '') + '.png';
    const candidates = [path.resolve(path.dirname(source), rel)];
    // Resource-pack texture paths are relative to the ancestor of particles/.
    let dir = path.dirname(source);
    while (path.dirname(dir) !== dir) {
      if (path.basename(dir).toLowerCase() === 'particles') candidates.push(path.resolve(path.dirname(dir), rel));
      dir = path.dirname(dir);
    }
    return uniqueMatch([...new Set(candidates)].filter(exists)) || '';
  }
  function planAssetSync(project, input) {
    const plan = {root: project.root, files: new Map(), expected: new Map(), rows: [], particles: [], textures: [], animations: [], missing: []};
    const read = file => {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('找不到资产文件：' + file);
      if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('单个资产超过 16 MiB：' + file);
      return fs.readFileSync(file);
    };
    function put(source, bytes, kind, extension, name) {
      if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('资产为空或超过 16 MiB：' + source);
      if (kind === 'textures' && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('贴图必须为 PNG：' + source);
      const original = name || path.basename(source);
      const stem = path.basename(original, path.extname(original)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'asset';
      const base = `${kind}/imported/${stem}_${hash(bytes)}`;
      let target = `${base}${extension}`, index = 2;
      while ((plan.files.has(target) && !plan.files.get(target).equals(bytes)) ||
        (fs.existsSync(fileAt(project.root, target)) && !read(fileAt(project.root, target)).equals(bytes))) target = `${base}_${index++}${extension}`;
      const reused = fs.existsSync(fileAt(project.root, target)) || plan.files.has(target);
      plan.expected.set(target, bytes);
      if (!reused) plan.files.set(target, bytes);
      plan.rows.push({source, target, kind, status: reused ? '复用已有文件' : '复制到包内'});
      return target;
    }
    const textures = new Map();
    function texture(file, bytes, name) {
      const identity = bytes ? 'bytes:' + hash(bytes) + ':' + name : path.resolve(file);
      if (textures.has(identity)) return textures.get(identity);
      const data = bytes || read(file);
      const target = !bytes && inside(project.root, file) ? relative(project.root, file) : put(file || name, data, 'textures', '.png', name);
      if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('贴图必须为 PNG：' + file);
      textures.set(identity, target);
      if (file && bytes) textures.set(path.resolve(file), target);
      return target;
    }
    for (const item of input.textures || []) {
      plan.textures.push({id: item.id, target: texture(item.source, item.bytes, item.name)});
    }
    for (const item of input.particles || []) {
      const json = JSON.parse(read(item.source).toString('utf8').replace(/^\uFEFF/, ''));
      if (!json.particle_effect?.description?.basic_render_parameters) throw new Error('不是有效的 Bedrock 粒子：' + item.source);
      const sourceTexture = particleTextureFile(item.source, json, item.texture);
      if (!sourceTexture) { plan.missing.push(item.source); continue; }
      const targetTexture = texture(sourceTexture);
      let target;
      if (inside(project.root, item.source)) {
        target = relative(project.root, item.source);
        plan.rows.push({source: item.source, target, kind: 'particles', status: '更新包内贴图绑定'});
      } else {
        json.particle_effect.description.basic_render_parameters.texture = targetTexture.replace(/\.png$/i, '');
        // Editor-only external paths must not travel into a portable copy.
        if (json.particle_effect.description.preview_texture) delete json.particle_effect.description.preview_texture;
        target = put(item.source, Buffer.from(JSON.stringify(json, null, 2) + '\n'), 'particles', '.json');
      }
      plan.particles.push({source: item.source, target, texture: targetTexture, json});
    }
    for (const source of [...new Set(input.animations || [])]) {
      if (inside(project.root, source)) continue;
      const bytes = read(source), json = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (!json.animations || typeof json.animations !== 'object' || Array.isArray(json.animations)) throw new Error('不是有效的动画文件：' + source);
      const target = put(source, bytes, 'animations', '.json');
      plan.animations.push({source, target, json});
    }
    const existing = filesIn(project.root);
    const bytes = existing.reduce((n, file) => n + fs.statSync(fileAt(project.root, file)).size, 0) + [...plan.files.values()].reduce((n, b) => n + b.length, 0);
    if (existing.length + plan.files.size > 4096 || bytes > 128 * 1024 * 1024) throw new Error('同步后特效包会超过资源大小限制');
    return plan;
  }
  function applyAssetSync(project, plan) {
    if (project.root !== plan.root || plan.missing.length) throw new Error('请先为所有粒子指定可用贴图');
    // Copy first without ever replacing an existing file. A partial I/O failure
    // removes only files created by this operation; source assets stay intact.
    for (const [rel, bytes] of plan.expected) if (!plan.files.has(rel) &&
      (!fs.existsSync(fileAt(project.root, rel)) || !fs.readFileSync(fileAt(project.root, rel)).equals(bytes))) throw new Error('复用文件在预览后发生变化，请重新同步：' + rel);
    const created = [];
    try {
      for (const [rel, bytes] of plan.files) {
        const dest = fileAt(project.root, rel);
        fs.mkdirSync(path.dirname(dest), {recursive: true});
        if (fs.existsSync(dest)) {
          if (!fs.readFileSync(dest).equals(bytes)) throw new Error('目标文件在预览后发生变化，请重新同步：' + rel);
          continue;
        }
        fs.writeFileSync(dest, bytes, {flag: 'wx'}); created.push(dest);
      }
    } catch (error) { for (const file of created) fs.unlinkSync(file); throw error; }
    const next = {...project, assets: [...project.assets], textures: [...project.textures], particles: project.particles.map(p => ({...p})), animations: [...project.animations]};
    function asset(key, type) { if (!next.assets.some(a => a.path === key)) next.assets.push({path: key, type}); }
    for (const key of new Set([...plan.textures.map(t => t.target), ...plan.particles.map(p => p.texture)])) {
      if (!next.textures.some(t => t.key === key)) next.textures.push({key, path: key});
      asset(key, '贴图');
    }
    for (const p of plan.particles) {
      const entry = {key: p.target, path: p.target, id: p.json.particle_effect.description.identifier || '', json: p.json, texture: p.texture};
      const index = next.particles.findIndex(particle => particle.key === p.target);
      if (index === -1) next.particles.push(entry); else next.particles[index] = entry;
      asset(p.target, '粒子');
    }
    for (const a of plan.animations) {
      for (const [id, animation] of Object.entries(a.json.animations)) {
        const key = `${a.target}#${id}`;
        if (!next.animations.some(source => source.key === key)) next.animations.push({key, path: a.target, id, animation});
      }
      asset(a.target, '动画');
    }
    try { saveSettings(next); }
    catch (error) { for (const file of created) fs.unlinkSync(file); throw error; }
    Object.assign(project, next);
    return created.length;
  }
  const Core = {scan, settings, validate, build, exportPack, saveSettings, createEmptyPack, modelViews, makeEffect, captureBindings, eventParticle, stableAlias, setEventAlias, events, fileAt, token, emptyGeometry, particleTextureFile, planAssetSync, applyAssetSync, publishRuntime, editBackupRoot};
  if (typeof Blockbench === 'undefined') { module.exports = Core; return; }

  // Desktop UI is below; the import/export core is also exercised by Node tests.
  let studio = null, dialog = null, style = null, menu = null;
  const actions = [];
  let originalSaveAnimation = null, saveAnimationHook = null;
  const syncUndo = new WeakMap();
  function restoreSyncState(entry, phase) {
    const record = syncUndo.get(entry);
    if (!record) return;
    const {session} = record, state = record[phase];
    session.texture = state.texture;
    session.textureObject = session.project.textures.find(t => t.uuid === state.textureId);
    session.animationObjects = new Map(state.animationObjects);
    session.snapshots = new Map(state.snapshots);
    for (const [key, texture] of state.effectTextures) {
      const effect = session.studio.effects.find(e => e.key === key);
      if (effect) effect.texture = texture;
    }
    for (const [key, texture] of state.particleTextures) {
      const particle = session.studio.particles.find(p => p.key === key);
      if (particle) particle.texture = texture;
    }
    saveSettings(session.studio);
  }
  const undoSyncListener = ({entry}) => guard(() => restoreSyncState(entry, 'before'));
  const redoSyncListener = ({entry}) => guard(() => restoreSyncState(entry, 'after'));
  let picker = null;
  function activeStudio() {
    const session = sessions.get(Project?.uuid);
    if (session && ModelProject.all.includes(session.project)) studio = session.studio;
    return studio;
  }
  const sessions = new Map();
  const errorBox = error => { console.error('[YesSteveVFX]', error); Blockbench.showMessageBox({title: 'YesSteveVFX', message: String(error.message || error)}); };
  function guard(action) { try { return action(); } catch (error) { errorBox(error); } }
  function saveWorkspace() {
    if (!studio) throw new Error('请先导入文件夹');
    saveSettings(studio);
    updateRuntimeAfterSave('VFX 工程绑定已保存');
  }
  function syncExternalAssets() {
    const session = sessions.get(Project?.uuid);
    if (!session || session.studio !== studio) throw new Error('请先通过 VFX 打开要编辑的模型，再同步当前标签的外部资产');
    const points = [];
    const particleInputs = new Map();
    for (const animation of Animation.all) for (const frame of animation.animators.effects?.particle || []) {
      for (const point of frame.data_points) {
        if (!point.file) continue;
        const source = path.resolve(point.file);
        const particle = studio.particles.find(p => path.resolve(fileAt(studio.root, p.path)) === source);
        const previewTexture = Animator.particle_effects[point.file]?.config.preview_texture;
        const texture = previewTexture || (particle?.texture ? fileAt(studio.root, particle.texture) : '');
        if (particle?.texture && texture && inside(studio.root, texture) && path.resolve(texture) === path.resolve(fileAt(studio.root, particle.texture))) continue;
        particleInputs.set(source, {source, texture});
        points.push({animation, frame, point, source});
      }
    }
    const textures = Texture.all.filter(t => !t.path || !inside(studio.root, t.path) || !studio.textures.some(a => fileAt(studio.root, a.path) === t.path));
    const input = {particles: [...particleInputs.values()], textures: textures.map(t => ({id: t.uuid, source: t.path, name: t.name,
      // Retain painting changes and embedded textures instead of copying a stale disk image.
      bytes: !t.path || t.saved === false || t.internal || !/\.png$/i.test(t.path) ? Buffer.from(t.getBase64(), 'base64') : undefined})),
      animations: Animation.all.map(a => a.path).filter(file => file && !inside(studio.root, file))};
    const context = {session, points, textures, animations: [...Animation.all], defaultTexture: Texture.getDefault()?.uuid || ''};
    showAssetSyncPlan(context, input);
  }
  function showAssetSyncPlan(context, input) {
    const plan = planAssetSync(studio, input);
    if (plan.missing.length) {
      const form = Object.fromEntries(plan.missing.map((source, index) => ['texture_' + index,
        {label: '粒子贴图：' + source, type: 'file', extensions: ['png'], filetype: 'PNG 贴图', readtype: 'none'}]));
      new Dialog({id: 'vfx_sync_textures', title: '请选择未找到的粒子贴图', width: 850, form,
        onConfirm(values) { guard(() => {
          plan.missing.forEach((source, i) => {
            if (!values['texture_' + i]) throw new Error('尚未指定贴图：' + source);
            input.particles.find(p => p.source === source).texture = values['texture_' + i];
          });
          this.hide(); showAssetSyncPlan(context, input);
        }); }}).show();
      return;
    }
    if (!plan.rows.length) { Blockbench.showQuickMessage('当前标签引用的资产都已在特效包内', 4000); return; }
    new Dialog({id: 'vfx_sync_assets', title: '同步外部资产到特效包', width: 1000, confirmIndex: 0, buttons: ['复制并更新引用', '取消'],
      component: {
        data: {rows: plan.rows, root: studio.root, model: !!context.session.model, modelTexture: context.defaultTexture,
          textures: Texture.all.map(t => ({id: t.uuid, name: t.name, path: t.path || '尚未保存的贴图'}))},
        template: `<div class="vfx-studio vfx-sync"><p class="vfx-path">目标特效包：{{root}}</p>
          <p>复制当前标签引用的粒子、贴图和外部动画，保留外部原文件。相同内容可复用，同名不同内容会使用独立文件名。</p>
          <label v-if="model && textures.length">此模型使用的贴图 <select v-model="modelTexture"><option v-for="t in textures" :key="t.id" :value="t.id">{{t.name}} · {{t.path}}</option></select></label>
          <div class="vfx-sync-files"><table><thead><tr><th>源资产</th><th>包内位置</th><th>处理方式</th></tr></thead><tbody><tr v-for="(r, i) in rows" :key="i"><td>{{r.source}}</td><td>{{r.target}}</td><td>{{r.status}}</td></tr></tbody></table></div>
          <p>完成后请保存动画，让新的粒子引用写回源文件，再导出到客户端。复制出的 PNG 包含当前绘制结果。</p></div>`
      },
      onConfirm() { guard(() => {
        if (Project !== context.session.project) throw new Error('当前标签已改变，请返回原模型重新同步');
        const selectedTexture = Texture.all.find(t => t.uuid === this.content_vue.modelTexture);
        const snapshot = () => ({texture: context.session.texture, textureId: context.session.textureObject?.uuid,
          animationObjects: [...context.session.animationObjects], snapshots: [...context.session.snapshots],
          effectTextures: studio.effects.filter(e => e.model === context.session.model).map(e => [e.key, e.texture]),
          particleTextures: studio.particles.filter(p => plan.particles.some(i => i.target === p.key)).map(p => [p.key, p.texture])});
        const before = snapshot();
        const copied = applyAssetSync(studio, plan);
        const affectedAnimations = [...new Set([...context.points.map(p => p.animation), ...context.animations.filter(a => plan.animations.some(p => p.source === a.path))])];
        Undo.initEdit({textures: context.textures, animations: affectedAnimations, elements: selectedTexture ? Cube.all : []});
        try {
          for (const record of context.points) {
            const imported = plan.particles.find(p => p.source === record.source);
            record.point.file = fileAt(studio.root, imported.target);
            record.point.effect = stableAlias(imported.target);
            record.animation.saved = false;
          }
          for (const item of plan.textures) {
            const texture = context.textures.find(t => t.uuid === item.id);
            texture.path = fileAt(studio.root, item.target); texture.name = path.basename(texture.path);
            texture.mode = 'link'; texture.internal = false; texture.saved = true;
            texture.setSourceFromLocalFile(); texture.startWatcher();
          }
          for (const animation of context.animations) {
            const imported = plan.animations.find(p => p.source === animation.path);
            if (!imported) continue;
            const id = animation.saved_name || animation.name;
            const source = studio.animations.find(a => a.path === imported.target && a.id === id);
            animation.path = fileAt(studio.root, imported.target);
            if (source) {
              context.session.animationObjects.set(animation.uuid, source.key);
              context.session.snapshots.set(animation.uuid, JSON.stringify(source.animation));
            }
            animation.saved = false;
          }
          if (selectedTexture && context.session.model) {
            const key = relative(studio.root, selectedTexture.path);
            context.session.texture = key; context.session.textureObject = selectedTexture;
            for (const effect of studio.effects.filter(e => e.model === context.session.model)) effect.texture = key;
            Cube.all.forEach(cube => cube.applyTexture(selectedTexture, true)); selectedTexture.select();
          }
        } finally {
          const entry = Undo.finishEdit('同步外部 VFX 资产');
          if (entry) syncUndo.set(entry, {session: context.session, before, after: snapshot()});
        }
        saveSettings(studio);
        for (const p of plan.particles) loadParticlePreview(find(studio.particles, p.target, '粒子'));
        Animator.preview(); this.hide();
        Blockbench.showMessageBox({title: '外部资产同步完成', message: `已复制 ${copied} 个文件，更新 ${context.points.length} 个粒子事件引用。\n\n请使用“保存当前编辑回工程”或动画保存按钮，将引用写回源文件。撤销可恢复当前编辑引用，已复制文件会保留在包内。`});
      }); }
    }).show();
  }
  function loadParticlePreview(particle) {
    const absolute = fileAt(studio.root, particle.path);
    // Blockbench indexes preview emitters by absolute file path, not identifier.
    const document = clone(particle.json);
    // Preview is indexed by absolute file path; retain the real identifier.
    // Synthetic identifiers must never leak into saved animation events.
    const loaded = Animator.loadParticleEmitter(absolute, JSON.stringify(document));
    if (!loaded) throw new Error(`Blockbench 无法加载粒子：${particle.path}`);
    if (particle.texture) {
      const texture = find(studio.textures, particle.texture, '粒子贴图');
      loaded.config.preview_texture = fileAt(studio.root, texture.path);
      loaded.config.updateTexture();
    }
    return loaded;
  }
  function loadParticleLibrary() {
    let loaded = 0;
    for (const particle of studio.particles) {
      loadParticlePreview(particle);
      loaded++;
    }
    return loaded;
  }
  function showHelp() {
    Blockbench.showMessageBox({
      title: 'YesSteveVFX Studio · 使用说明', width: 760,
      message: [
        '**第一次使用**',
        '1. 打开 VFX → 导入工程文件夹，选择包含模型、动画、粒子 JSON 和 PNG 的文件夹；已有 config/yesstevevfx/packs/<pack> 也可以直接选择。',
        '2. 导入后先显示模型选择窗口，列出每个 geo / geometry、关联动画文件及动画数量。先“关联动画与贴图”，再“打开 / 切换标签”。已打开的模型会复用原标签。',
        '3. 在“资产与绑定”中按时间与事件序号指定粒子文件。同名事件也可绑定不同粒子；数字或中文文件名不影响导出。',
        '4. 点击“检查引用”，确认没有未绑定的粒子、贴图或定位器。点击“打开 / 更新 Blockbench 预览”后，在动画模式按空格播放。',
        '动画列表载入关联文件中的全部动画。动画行/文件分组的保存按钮写回源文件，并由 VFX 校正粒子绑定、生成备份；共享动画发生保存冲突时会阻止覆盖。',
        '5. 在 Blockbench 中编辑骨骼、定位器、贴图或动画；完成后点击 VFX → 保存当前编辑回工程。原文件会先备份；客户端包的备份位于 packs 外的 vfx-edit-backups。保存后自动更新运行时包。',
        '6. 点击“导出到客户端”，选择 .minecraft；检测到 versions 时再选择具体隔离版本。进入游戏后执行 /vfx_client reload，再用 /vfx_client play <pack_id>:<effect> test 播放。',
        '',
        '**常用菜单**',
        'VFX → 导入工程文件夹：开始或切换工程。',
        'VFX → 资产与绑定：重新打开当前工程。',
        'VFX → 切换模型 / 打开其他模型：选择同一包里的另一个 geo 或 geometry。',
        'VFX → 重新扫描资产：将新的模型、动画、粒子、贴图放入工程目录后，更新资产列表。',
        'VFX → 同步外部资产到特效包：复制当前标签引用的外部粒子、贴图和动画，更新引用后再保存。',
        'VFX → 保存当前编辑回工程：写回当前标签并生成游戏用资源与映射，客户端可直接 reload。',
        'VFX → 更新当前包的运行时资源：从已保存的源文件重新生成可播放包。',
        'VFX → 导出到客户端：写入 config/yesstevevfx/packs，并把旧包移到 vfx-backups。',
        '',
        '预览和游戏渲染是两条独立链路：预览缺失优先检查绑定或粒子 JSON；预览正常而游戏缺失再检查导出包和运行时日志。'
      ].join('\n')
    });
  }
  function bindPreview(animation, effect) {
    if (!effect) return;
    for (const frame of animation.animators.effects?.particle || []) {
      frame.data_points.forEach((point, index) => {
        const event = {key: frame.time + '#' + index, effect: point.effect};
        const particle = studio.particles.find(p => p.key === eventParticle(studio, effect, event));
        if (!particle) return;
        loadParticlePreview(particle);
        point.file = fileAt(studio.root, particle.path);
      });
    }
  }
  function attachAnimations(session) {
    const effects = studio.effects.filter(e => session.model ? e.model === session.model : !e.model && !e.modelUnresolved);
    const files = new Set(effects.map(e => studio.animations.find(a => a.key === e.animation)?.path).filter(Boolean));
    for (const filePath of files) {
      // Always use the current disk snapshot when opening a new model tab.
      // Existing tabs retain their original snapshot for conflict detection.
      const document = readJson(fileAt(studio.root, filePath));
      for (const source of studio.animations.filter(a => a.path === filePath)) {
        if (document.animations?.[source.id]) source.animation = clone(document.animations[source.id]);
      }
      const sources = studio.animations.filter(a => a.path === filePath);
      const missing = sources.filter(a => !session.project.animations.some(live => session.animationObjects.get(live.uuid) === a.key));
      if (!missing.length) continue;
      const file = {name: path.basename(filePath), path: fileAt(studio.root, filePath),
        content: JSON.stringify({format_version: '1.8.0', animations: Object.fromEntries(missing.map(a => [a.id, a.animation]))})};
      const loaded = AnimationCodec.codecs.bedrock.loadFile(file);
      for (const animation of loaded) {
        const source = sources.find(a => a.id === animation.name);
        session.animationObjects.set(animation.uuid, source.key);
        session.snapshots.set(animation.uuid, JSON.stringify(source.animation));
        const effect = effects.find(e => e.animation === source.key);
        // Unassigned siblings remain visible, but are not silently assigned
        // to this model merely because they share an animation.json file.
        if (effect) session.animationEffects.set(animation.uuid, effect);
        bindPreview(animation, effect);
      }
      session.animationFile ||= filePath;
    }
    for (const animation of session.project.animations) {
      const effect = effects.find(e => e.animation === session.animationObjects.get(animation.uuid));
      session.animationEffects.set(animation.uuid, effect);
      if (animation.saved) bindPreview(animation, effect);
    }
  }
  function showModelPicker() {
    if (!studio) throw new Error('请先打开特效包');
    refreshSavedAnimations();
    picker?.delete();
    picker = new Dialog({id: 'vfx_models', title: 'VFX · 选择模型', width: 1000, singleButton: true,
      component: {
        data: {views: modelViews(studio), search: '', root: studio.root,
          counts: {models: studio.models.length, animations: studio.animations.length, particles: studio.particles.length}},
        computed: {filtered() { return this.views.filter(v => JSON.stringify([v.model?.path, v.model?.id, v.effects.map(e => e.name)]).toLowerCase().includes(this.search.toLowerCase())); }},
        methods: {
          open(view) { guard(() => {
            const effect = view.effects[0] || {key: 'model_' + view.key, name: view.model.id, model: view.key,
              texture: '', animation: '', bindings: {}, eventBindings: {}, duration: 120, enabled: false};
            preview(effect, {allowIncomplete: true});
          }); },
          bind(view) { guard(() => showModelBindings(view)); },
          assets() { picker.hide(); guard(showStudio); }
        },
        template: `<div class="vfx-studio vfx-models">
          <div class="vfx-models-header">
            <p class="vfx-models-status">已载入 {{counts.models}} 个模型 · {{counts.animations}} 个动画 · {{counts.particles}} 个粒子</p>
            <p class="vfx-path" :title="root">{{root}}</p>
          </div>
          <div class="vfx-models-toolbar">
            <input type="text" class="vfx-models-search" aria-label="搜索模型、geometry 或特效" placeholder="搜索模型、geometry 或特效" v-model="search">
            <button type="button" @click="assets">资产与绑定</button>
          </div>
          <div class="vfx-models-list">
            <p class="vfx-models-empty" v-if="!views.length">尚无模型。将 geo.json、animation.json、粒子 JSON 和 PNG 放入工程目录，再使用 VFX → 重新扫描资产。</p>
            <p class="vfx-models-empty" v-else-if="!filtered.length">没有找到匹配的模型，请更换搜索词。</p>
            <article class="vfx-model-card" v-for="v in filtered" :key="v.key">
              <strong class="vfx-model-title">{{v.model ? v.model.path : '仅粒子'}}</strong>
              <p class="vfx-model-meta" v-if="v.model">geometry #{{v.model.index}} · {{v.bones}} 骨骼 · {{v.cubes}} 方块</p>
              <dl class="vfx-model-info">
                <template v-if="v.model"><dt>模型标识</dt><dd>{{v.model.id}}</dd></template>
                <dt>特效</dt><dd>{{v.effects.map(e => e.name).join('、') || '尚未关联'}}</dd>
                <dt>动画文件</dt><dd><div class="vfx-model-file" v-for="f in v.files" :key="f.path"><span>{{f.path}}</span><span class="vfx-model-count">{{f.count}} 个动画</span></div><span v-if="!v.files.length">尚未关联</span></dd>
                <dt v-if="v.model">粒子</dt><dd v-if="v.model">{{v.particles || 0}} 个已绑定</dd>
              </dl>
              <details class="vfx-model-animations" v-if="v.animations.length"><summary>查看动画名称（{{v.animations.length}}）</summary><ul><li v-for="a in v.animations" :key="a.key">{{a.id}}</li></ul></details>
              <p class="vfx-model-hint" v-if="!v.effects.length">先关联动画与贴图，再打开模型进行编辑。</p>
              <div class="vfx-model-actions"><button type="button" @click="open(v)">打开 / 切换标签</button><button type="button" v-if="v.model" @click="bind(v)">关联动画与贴图</button></div>
            </article>
          </div>
        </div>`
      }});
    picker.show();
  }
  function showModelBindings(view) {
    const form = {texture: {label: '模型贴图', type: 'select', value: view.effects[0]?.texture || '',
      options: {'': '未指定', ...Object.fromEntries(studio.textures.map(t => [t.key, t.path]))}}};
    studio.animations.forEach((a, i) => {
      const owners = studio.effects.filter(e => e.animation === a.key && e.model !== view.key);
      form['a' + i] = {label: a.id + ' · ' + a.path + (owners.length ? '（已有其它模型绑定，选中将新增独立特效）' : ''),
        type: 'checkbox', value: view.effects.some(e => e.animation === a.key)};
    });
    new Dialog({id: 'vfx_model_bindings', title: '关联动画 · ' + view.model.id, width: 900, form,
      onConfirm(values) { guard(() => {
        studio.animations.forEach((a, i) => {
          const current = studio.effects.filter(e => e.model === view.key && e.animation === a.key);
          if (values['a' + i]) {
            if (!current.length) {
              const unbound = studio.effects.find(e => !e.model && e.modelUnresolved && e.animation === a.key);
              const effect = unbound || makeEffect(studio, a, view.key);
              effect.model = view.key; effect.modelUnresolved = false; effect.texture = values.texture; effect.enabled = true;
              if (!unbound) studio.effects.push(effect);
            }
            current.forEach(e => {e.texture = values.texture; e.modelUnresolved = false;});
          } else current.forEach(e => {e.model = ''; e.modelUnresolved = true; e.enabled = false;});
        });
        saveSettings(studio); this.hide(); showModelPicker();
      }); }}).show();
  }

  function showAnimationPanel() {
    Modes.options.animate.select();
    const panel = Interface.Panels.animations;
    // In Blockbench 5.x the animation tab may share another panel's
    // container. Unfolding the animation panel alone leaves that host hidden.
    const host = panel.getContainerPanel?.() || panel;
    host.selectTab?.(panel);
    host.fold(false);
    const view = panel.vue;
    if (view) {
      view.search_term = '';
      for (const animation of Animation.all) {
        const group = (view.group_animations_by_file ? animation.path : animation.group_name) || '';
        view.$set(view.files_folded, group, false);
      }
    }
  }
  function preview(effect, options = {}) {
    const errors = validate(studio, effect);
    if (errors.length && !options.allowIncomplete) throw new Error(errors.join('\n'));
    // Reattach an already-open source tab after a plugin reload. Do not replace
    // its live model or unsaved animation edits with a fresh disk import.
    if (effect.model) {
      const model = find(studio.models, effect.model, '模型');
      const tab = ModelProject.all.find(p => !sessions.has(p.uuid) && p.export_path &&
        path.resolve(p.export_path) === path.resolve(fileAt(studio.root, model.path)) &&
        'geometry.' + p.geometry_name === model.id);
      if (tab) {
        const session = {studio, effect, project: tab, model: effect.model, texture: effect.texture,
          textureObject: tab.textures.find(t => t.path && effect.texture && path.resolve(t.path) === path.resolve(fileAt(studio.root, effect.texture))),
          animationObjects: new Map(), animationEffects: new Map(), snapshots: new Map()};
        for (const animation of tab.animations) {
          const source = studio.animations.find(a => animation.path && path.resolve(fileAt(studio.root, a.path)) === path.resolve(animation.path) && a.id === (animation.saved_name || animation.name));
          if (source) {
            session.animationObjects.set(animation.uuid, source.key);
            session.snapshots.set(animation.uuid, JSON.stringify(source.animation));
          }
        }
        sessions.set(tab.uuid, session);
      }
    }
    const existing = [...sessions.values()].find(s => s.studio === studio &&
      s.model === effect.model && ModelProject.all.includes(s.project));
    if (existing) {
      existing.project.select();
      attachAnimations(existing);
      if (effect.texture && existing.texture !== effect.texture) {
        const asset = find(studio.textures, effect.texture, '模型贴图');
        const texture = Texture.all.find(t => t.path === fileAt(studio.root, asset.path)) || new Texture({keep_size: true}).fromPath(fileAt(studio.root, asset.path)).add();
        Cube.all.forEach(cube => cube.applyTexture(texture, true)); texture.select();
        existing.texture = effect.texture; existing.textureObject = texture;
      }
      loadParticleLibrary();
      for (const animation of Animation.all) if (animation.saved) bindPreview(animation, existing.animationEffects.get(animation.uuid));
      Animation.all.find(a => existing.animationObjects.get(a.uuid) === effect.animation)?.select();
      dialog?.hide(); picker?.hide(); showAnimationPanel(); Animator.preview(); return;
    }
    const model = effect.model ? find(studio.models, effect.model, '模型') : null;
    if (model) {
      const absolute = fileAt(studio.root, model.path);
      const document = readJson(absolute);
      const geometry = document['minecraft:geometry']?.[model.index];
      if (!geometry) throw new Error('源文件中找不到模型：' + model.path);
      if (!geometry.description?.identifier || document['minecraft:geometry'].filter(g => g.description?.identifier === geometry.description.identifier).length !== 1) {
        throw new Error('同一 geo 文件中的 geometry identifier 必须存在且唯一，才能安全地保存：' + model.path);
      }
      model.geometry = clone(geometry); model.id = geometry.description.identifier;
      loadModelFile({name: path.basename(absolute), path: absolute,
        content: JSON.stringify({...document, 'minecraft:geometry': [geometry]})});
      Project.name = path.basename(model.path) + ' · ' + model.id;
    } else {
      setupProject(Formats.bedrock);
      Codecs.bedrock.load({format_version: '1.12.0', 'minecraft:geometry': [emptyGeometry()]},
        {path: '', no_file: true}, {import_to_current_project: true});
      Project.name = 'VFX · ' + effect.name;
    }
    const project = Project;
    const asset = studio.textures.find(t => t.key === effect.texture);
    const texture = asset ? (Texture.all.find(t => t.path === fileAt(studio.root, asset.path)) || new Texture({keep_size: true}).fromPath(fileAt(studio.root, asset.path)).add()) : null;
    if (texture) { texture.select(); Cube.all.forEach(cube => cube.applyTexture(texture, true)); }
    const session = {studio, effect, project, model: effect.model, texture: effect.texture, textureObject: texture,
      animationObjects: new Map(), animationEffects: new Map(), snapshots: new Map()};
    sessions.set(project.uuid, session);
    loadParticleLibrary(); attachAnimations(session);
    (Animation.all.find(a => session.animationObjects.get(a.uuid) === effect.animation) || Animation.all[0])?.select();
    dialog?.hide(); picker?.hide(); showAnimationPanel(); Timeline.setTime(0); Animator.preview();
    Blockbench.showQuickMessage('已打开源模型，载入 ' + Animation.all.length + ' 个动画、' + studio.particles.length + ' 个粒子。', 5000);
  }

  function capture(options = {}) {
    const session = sessions.get(Project?.uuid);
    if (!session || session.studio !== studio) throw new Error('当前标签不是此 VFX 工程的预览标签');
    const writes = new Map();
    if (session.model && options.model !== false) {
      const model = find(studio.models, session.model, '模型');
      const compiled = Codecs.bedrock.compile({raw: true});
      const geometry = clone(compiled['minecraft:geometry'][0]);
      geometry.description.identifier = model.id;
      const document = readJson(fileAt(studio.root, model.path));
      if (document['minecraft:geometry']?.[model.index]?.description?.identifier !== model.id) throw new Error('模型文件的 geometry 顺序或标识已改变，请重新打开模型后保存：' + model.path);
      document['minecraft:geometry'][model.index] = geometry;
      writes.set(model.path, Buffer.from(JSON.stringify(document, null, 2) + '\n'));
    }
    const pendingAnimations = [];
    for (const animation of options.animations || Animation.all) {
      let key = session.animationObjects.get(animation.uuid);
      let source = studio.animations.find(a => a.key === key);
      if (source && animation.path && path.resolve(animation.path) !== path.resolve(fileAt(studio.root, source.path))) source = null;
      if (!source) {
        if (animation.path && !inside(studio.root, animation.path)) throw new Error('动画文件不在工程内，请先使用 VFX → 同步外部资产到特效包：' + animation.path);
        const rel = animation.path ? relative(studio.root, animation.path) : session.animationFile || `animations/${token(animation.name)}.animation.json`;
        key = `${rel}#${animation.name}`;
        source = {key, path: rel, id: animation.name};
      }
      const animationEffect = studio.effects.find(e => e.animation === source.key && e.model === session.model);
      const compiled = typeof AnimationCodec !== 'undefined' ? AnimationCodec.codecs.bedrock.compileAnimation(animation) : animation.compileBedrockAnimation();
      let doc = writes.has(source.path) ? JSON.parse(writes.get(source.path).toString()) :
        (fs.existsSync(fileAt(studio.root, source.path)) ? readJson(fileAt(studio.root, source.path)) : {format_version: '1.8.0', animations: {}});
      const snapshot = session.snapshots.get(animation.uuid);
      if (snapshot !== undefined && JSON.stringify(doc.animations[source.id]) !== snapshot) {
        throw new Error(`动画 ${source.id} 已被其他标签或外部程序修改，已阻止覆盖。请先将当前修改另存为备份，再关闭此标签并重新打开模型。`);
      }
      if (snapshot === undefined && doc.animations[source.id]) throw new Error(`目标文件中已有同名动画：${source.id}，请先修改新动画名称。`);
      if (source.id !== animation.name && doc.animations[animation.name]) throw new Error(`动画名称已存在：${animation.name}`);
      // Match each compiled event to its actual preview file. Never infer an
      // ambiguous particle identity from Blockbench's filename-derived alias.
      const points = (animation.animators.effects?.particle || []).flatMap(frame => frame.data_points.map((point, index) => ({key: `${Number(frame.time)}#${index}`, file: point.file})));
      const bindings = captureBindings(studio, animationEffect, compiled, points);
      if (source.id !== animation.name) delete doc.animations[source.id];
      doc.animations[animation.name] = compiled;
      writes.set(source.path, Buffer.from(JSON.stringify(doc, null, 2) + '\n'));
      pendingAnimations.push({source, animation, compiled, bindings});
    }
    if (options.texture !== false && session.textureObject && session.textureObject.saved === false) {
      writes.set(session.texture, Buffer.from(session.textureObject.getBase64(), 'base64'));
    }
    const backup = path.join(editBackupRoot(studio.root), `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    for (const [rel, bytes] of writes) {
      const dest = fileAt(studio.root, rel);
      if (fs.existsSync(dest)) { const old = fileAt(backup, rel); fs.mkdirSync(path.dirname(old), {recursive: true}); fs.copyFileSync(dest, old); }
      fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.writeFileSync(dest, bytes);
    }
    if (session.model) {
      const model = find(studio.models, session.model, '模型');
      model.geometry = readJson(fileAt(studio.root, model.path))['minecraft:geometry'][model.index];
    }
    for (const {source, animation, compiled, bindings} of pendingAnimations) {
      source.animation = clone(compiled);
      const previousKey = source.key;
      source.id = animation.name;
      source.key = `${source.path}#${source.id}`;
      let effects = studio.effects.filter(e => e.animation === previousKey);
      if (!effects.length) {
        const effect = makeEffect(studio, source, session.model);
        effect.texture = session.texture; studio.effects.push(effect); effects = [effect];
      }
      for (const effect of effects) {
        effect.animation = source.key;
        // Shared animation sources have the same saved aliases, but retain
        // each model's explicit particle overrides unless this tab edited them.
        if (effect.model === session.model || !Object.keys(effect.eventBindings || {}).length) effect.eventBindings = clone(bindings);
        else for (const event of events(compiled)) {
          const previous = effect.eventBindings[event.key];
          if (previous) previous.alias = event.effect;
        }
      }
      if (!studio.animations.includes(source)) studio.animations.push(source);
      session.animationObjects.set(animation.uuid, source.key);
      for (const other of sessions.values()) if (other.studio === studio) {
        for (const [uuid, oldKey] of other.animationObjects) if (oldKey === previousKey) other.animationObjects.set(uuid, source.key);
      }
      session.animationEffects.set(animation.uuid, effects.find(e => e.model === session.model));
      session.snapshots.set(animation.uuid, JSON.stringify(compiled));
      for (const event of events(compiled)) {
        const point = (animation.animators.effects?.particle || []).find(f => Math.abs(f.time - Number(event.time)) < 0.000001)?.data_points[event.index];
        if (point) point.effect = event.effect;
      }
      animation.path = fileAt(studio.root, source.path);
      animation.saved_name = animation.name;
      animation.saved = true;
    }
    saveSettings(studio);
    updateRuntimeAfterSave(`已保存 ${writes.size} 个编辑资产`);
  }
  function updateRuntimeAfterSave(message) {
    try {
      refreshSavedAnimations();
      const result = publishRuntime(studio);
      Blockbench.showQuickMessage(`${message}，已更新 ${result.effects} 个运行时特效。客户端可执行 /vfx_client reload`, 6000);
    } catch (error) {
      Blockbench.showMessageBox({title: '源文件已保存，运行时包尚未更新', message: `${message}。\n\n${error.message}\n\n请修复绑定后使用 VFX → 更新当前包的运行时资源，再在客户端 reload。`});
    }
  }
  function updateCurrentRuntime() {
    if (!studio) throw new Error('请先导入工程文件夹');
    for (const session of sessions.values()) if (session.studio === studio && ModelProject.all.includes(session.project) &&
      session.project.animations.some(a => !a.saved)) throw new Error('有未保存的动画，请先保存，再更新运行时资源。');
    refreshSavedAnimations();
    const result = publishRuntime(studio);
    Blockbench.showMessageBox({title: '当前包已更新', message: `已生成 ${result.effects} 个可播放特效，更新 ${result.count} 个文件。\n\n客户端执行 /vfx_client reload 即可。\n${result.backup ? '备份：' + result.backup : ''}`});
  }
  function refreshSavedAnimations() {
    // Native Save Model writes the linked geometry file. Export must read
    // the updated model instead of silently using the original scan snapshot.
    const modelDocuments = new Map();
    for (const model of studio.models) {
      if (!modelDocuments.has(model.path)) modelDocuments.set(model.path, readJson(fileAt(studio.root, model.path)));
      const geometry = modelDocuments.get(model.path)['minecraft:geometry']?.[model.index];
      if (!geometry) throw new Error(`源文件中找不到模型：${model.path} #${model.index}`);
      model.geometry = clone(geometry);
      model.id = geometry.description?.identifier || '';
    }
    // Native animation saves write directly to the linked JSON. Read those
    // changes before showing bindings or exporting, rather than cached data.
    const documents = new Map();
    const savedNames = new Map();
    for (const session of sessions.values()) {
      if (session.studio !== studio || !ModelProject.all.includes(session.project)) continue;
      for (const animation of session.project.animations) {
        const key = session.animationObjects.get(animation.uuid);
        const source = studio.animations.find(candidate => candidate.key === key);
        if (source && animation.saved && animation.path === fileAt(studio.root, source.path)) savedNames.set(key, animation.saved_name || animation.name);
      }
    }
    for (const source of studio.animations) {
      if (!documents.has(source.path)) documents.set(source.path, readJson(fileAt(studio.root, source.path)));
      const id = savedNames.get(source.key) || source.id;
      const animation = documents.get(source.path).animations?.[id];
      if (!animation) throw new Error(`动画文件中已找不到 ${id}，请重新导入并检查特效绑定。`);
      source.id = id;
      source.animation = clone(animation);
    }
  }
  function exportTo(parent) {
    if (!studio) throw new Error('请先导入工程文件夹');
    for (const session of sessions.values()) if (session.studio === studio && ModelProject.all.includes(session.project)) {
      if (session.project.animations.some(a => !a.saved)) throw new Error(`标签“${session.project.name}”有未保存的动画，请先保存再导出。`);
    }
    refreshSavedAnimations();
    const result = exportPack(studio, parent);
    Blockbench.showMessageBox({title: 'VFX 导出完成', message: `${result.count} 个文件已写入：\n${result.target}\n\n在游戏执行 /vfx_client reload。${result.backup ? '\n旧包备份：' + result.backup : ''}`});
  }
  function exportClient() {
    const root = Blockbench.pickDirectory({title: '选择 .minecraft 或启用版本隔离的版本目录'});
    if (!root) return;
    const versionsPath = path.join(root, 'versions');
    if (fs.existsSync(versionsPath)) {
      const versions = fs.readdirSync(versionsPath, {withFileTypes: true}).filter(e => e.isDirectory());
      const choices = {root: '公共 .minecraft（未启用版本隔离）'};
      versions.forEach((v, i) => choices[`v${i}`] = `版本目录：${v.name}`);
      new Dialog({id: 'vfx_target', title: '选择客户端实例', form: {target: {label: '写入位置', type: 'select', options: choices, value: 'root'}},
        onConfirm(values) { this.hide(); guard(() => {
          const target = values.target === 'root' ? root : path.join(versionsPath, versions[Number(values.target.slice(1))].name);
          exportTo(path.join(target, 'config', 'yesstevevfx', 'packs'));
        }); }}).show();
    } else exportTo(path.join(root, 'config', 'yesstevevfx', 'packs'));
  }
  function createPack() {
    const parent = Blockbench.pickDirectory({title: '选择新特效包的父目录'});
    if (!parent) return;
    new Dialog({id: 'vfx_new_pack', title: '新建 YesSteveVFX 特效包', width: 620,
      form: {
        packId: {label: '包 ID（用于资源 ID，只允许英文/数字/._-）', type: 'text', value: 'new_pack'},
        displayName: {label: '显示名称（可使用中文）', type: 'text', value: '新特效包'},
        open: {label: '创建后立即打开工程', type: 'checkbox', value: true}
      },
      onConfirm(values) {
        this.hide();
        guard(() => {
          const root = createEmptyPack(parent, values);
          if (values.open !== false) {
            if (studio) saveSettings(studio);
            studio = scan(root);
            showStudio();
          }
          Blockbench.showMessageBox({title: '特效包已创建', message: `已创建空特效包：\n${root}\n\n请在资产与绑定中添加特效、导入模型/动画/粒子后再导出。`});
        });
      }
    }).show();
  }
  function showStudio() {
    if (!studio) throw new Error('请先使用 VFX → 导入工程文件夹');
    let refreshError = '';
    try { refreshSavedAnimations(); }
    catch (error) {
      refreshError = error.message || String(error);
      console.error('[YesSteveVFX] refresh animations failed', error);
    }
    dialog?.hide();
    dialog = new Dialog({id: 'yesstevevfx_studio', title: 'YesSteveVFX · 资产与绑定', width: 1060, singleButton: true,
      component: {
        // Dialog components are mounted as a Vue root instance by Blockbench.
        // Use a data object here instead of a factory function: this matches
        // Blockbench's own dialog components and prevents a blank dialog on
        // older Vue builds bundled with Blockbench 5.x.
        data: {p: studio, selected: studio.effects[0]?.key || '', tab: 'effects', message: refreshError},
        errorCaptured(error) {
          this.message = `界面渲染错误：${error.message || error}`;
          console.error('[YesSteveVFX] dialog render error', error);
          return false;
        },
        computed: {
          current() { return this.p.effects.find(e => e.key === this.selected); },
          eventRows() { return events(this.p.animations.find(a => a.key === this.current?.animation)?.animation); },
        },
        methods: {
          save() { guard(saveWorkspace); }, check() { this.message = validate(studio).join('\n') || '检查通过：每个动画事件、定位器和贴图都有明确绑定。'; },
          help() { showHelp(); }, preview() { guard(() => preview(this.current)); }, capture() { guard(capture); this.$forceUpdate(); },
          syncAssets() { guard(syncExternalAssets); }, exportClient() { guard(exportClient); }, exportFolder() { guard(() => { const dir = Blockbench.pickDirectory({title: '选择导出父目录（将创建包 ID 子目录）'}); if (dir) exportTo(dir); }); },
          binding(event) { return eventParticle(this.p, this.current, event); },
          bind(event, value) { this.$set(this.current.eventBindings, event.key, {alias: event.effect, particle: value}); },
          modelChanged() { this.current.modelUnresolved = false; },
          add() { const effect = makeEffect(this.p); this.p.effects.push(effect); this.selected = effect.key; },
          openParticle(particle) { new Dialog({id: 'vfx_particle_json', title: particle.path, width: 800, form: {json: {type: 'textarea', label: 'Bedrock 粒子 JSON', value: JSON.stringify(particle.json, null, 2)}}, onConfirm(values) { guard(() => { const parsed = JSON.parse(values.json); if (!parsed.particle_effect?.description) throw new Error('缺少 particle_effect.description'); const source = fileAt(studio.root, particle.path); const backup = path.join(path.dirname(studio.root), `${path.basename(studio.root)}-edit-backups`, `${Date.now()}-${token(particle.path)}.json`); fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.copyFileSync(source, backup); fs.writeFileSync(source, JSON.stringify(parsed, null, 2) + '\n'); particle.json = parsed; particle.id = parsed.particle_effect.description.identifier || ''; this.hide(); }); }}).show(); }
        },
        template: `<div class="vfx-studio">
          <p class="vfx-path">{{p.root}}</p>
          <div class="vfx-toolbar"><button @click="help">使用说明</button><button @click="save">保存工程绑定</button><button @click="check">检查引用</button><button @click="syncAssets">同步外部资产到特效包</button><button @click="capture">保存当前编辑回工程</button><button @click="exportFolder">导出到文件夹</button><button @click="exportClient">导出到客户端</button></div>
          <div class="vfx-toolbar"><label>包 ID <input v-model="p.packId"></label><label>显示名 <input v-model="p.displayName"></label></div>
          <p>{{p.models.length}} 模型 · {{p.animations.length}} 动画 · {{p.particles.length}} 粒子 · {{p.textures.length}} 贴图</p>
          <div class="vfx-toolbar"><button @click="tab='effects'">特效绑定</button><button @click="tab='particles'">粒子与贴图</button><button @click="tab='assets'">全部资产</button></div>
          <div v-if="tab==='effects'" class="vfx-columns"><div class="vfx-list"><button @click="add">＋ 新建特效</button><div v-for="e in p.effects" :key="e.key"><input type="checkbox" v-model="e.enabled"><button @click="selected=e.key" :class="{selected:selected===e.key}">{{e.name}}</button></div><p v-if="!p.effects.length">当前工程还没有特效。点击“＋ 新建特效”，再选择模型、动画和粒子。</p></div>
            <div v-if="current" class="vfx-detail">
              <label>特效名<input v-model="current.name"></label><label>持续时间（tick；20 tick = 1 秒）<input type="number" min="1" max="72000" v-model.number="current.duration"></label>
              <label>模型<select v-model="current.model" @change="modelChanged"><option value="">无模型（仅粒子）</option><option v-for="m in p.models" :value="m.key">{{m.path}} · {{m.id}}</option></select></label>
              <p v-if="current.modelUnresolved">模型关系尚未确认。请选择模型，或点击<button @click="modelChanged">确认为仅粒子</button></p>
              <label v-if="current.model">模型贴图<select v-model="current.texture"><option value="">请选择</option><option v-for="t in p.textures" :value="t.key">{{t.path}}</option></select></label>
              <label>动画<select v-model="current.animation"><option value="">无动画（静态模型）</option><option v-for="a in p.animations" :value="a.key">{{a.id}} · {{a.path}}</option></select></label>
              <p>逐事件绑定粒子文件；同名事件也可选择不同粒子。导出时自动生成匹配的实体引用。</p>
              <label v-for="event in eventRows" :key="event.key">{{event.time}} s · 事件 {{event.index + 1}} · {{event.effect}} · {{event.locator || '实体原点'}}<select :value="binding(event) || ''" @change="bind(event, $event.target.value)"><option value="">未绑定</option><option v-for="r in p.particles" :value="r.key">{{r.path}}</option></select></label>
              <table><tr><th>触发时间</th><th>事件别名</th><th>定位器</th></tr><tr v-for="r in eventRows"><td>{{r.time}} s</td><td>{{r.effect}}</td><td>{{r.locator || '实体原点'}}</td></tr></table>
              <button @click="preview">打开 / 更新 Blockbench 预览</button><p>空格播放。模型、贴图绘制、动画和定位器在主界面编辑；完成后点击“保存当前编辑回工程”。</p>
            </div></div>
          <div v-if="tab==='particles'"><div v-for="r in p.particles" class="vfx-particle"><strong>{{r.path}}</strong><p>源 ID：{{r.id || '未设置'}}（导出时自动生成独立 ID）</p><label>粒子贴图<select v-model="r.texture"><option value="">未绑定</option><option v-for="t in p.textures" :value="t.key">{{t.path}}</option></select></label><button @click="openParticle(r)">编辑粒子 JSON</button></div></div>
          <table v-if="tab==='assets'"><tr><th>资产类型</th><th>文件</th></tr><tr v-for="a in p.assets"><td>{{a.type}}</td><td>{{a.path}}</td></tr></table>
          <pre v-if="message" class="vfx-message">{{message}}</pre><details v-if="p.warnings.length"><summary>导入提示（{{p.warnings.length}}）</summary><p v-for="w in p.warnings">{{w}}</p></details>
        </div>`
      }
    });
    dialog.show();
  }
  function importProject() {
    const root = Blockbench.pickDirectory({title: '选择 VFX 源工程文件夹或已有特效包'});
    if (!root) return;
    if (studio) saveSettings(studio);
    studio = scan(root);
    showModelPicker();
  }
  function rescan() {
    if (!studio) throw new Error('请先导入工程文件夹');
    saveSettings(studio);
    Object.assign(studio, scan(studio.root));
    for (const session of sessions.values()) if (session.studio === studio) {
      session.effect = studio.effects.find(e => e.key === session.effect.key) || session.effect;
    }
    showModelPicker();
  }
  // Blockbench creates a temporary Plugin instance under the selected file's
  // base name before evaluating a local plugin.  Registering the canonical ID
  // directly is correct for `yesstevevfx_studio.js`, but older copies of this
  // plugin were distributed as `yesstevevfx.js` and Blockbench then rejected
  // the file before onload.  Prefer the canonical ID and fall back to the
  // currently loading local instance when Blockbench exposes it.  This keeps
  // old local copies loadable while new installations still use the stable ID.
  const pluginApi = typeof BBPlugin !== 'undefined' ? BBPlugin : Plugin;
  const registered = typeof Plugins !== 'undefined' && Plugins.registered ? Plugins.registered : {};
  const loadingLocal = Object.keys(registered).find(id => {
    const entry = registered[id];
    return entry && entry.source === 'file' && entry.installed === false && entry.path;
  });
  const pluginId = registered.yesstevevfx_studio ? 'yesstevevfx_studio' : (loadingLocal || 'yesstevevfx_studio');
  pluginApi.register(pluginId, {
    title: 'YesSteveVFX Studio', author: 'DanielFQZ', description: '导入 VFX 文件夹、绑定模型/动画/粒子/贴图、预览并导出 Minecraft 特效包。',
    icon: 'auto_awesome', version: '0.2.1', min_version: '5.0.0', variant: 'desktop', tags: ['Animation', 'Minecraft: Java Edition'],
    onload() {
      Blockbench.on('undo', undoSyncListener);
      Blockbench.on('redo', redoSyncListener);
      style = Blockbench.addCSS('.vfx-studio{padding:12px}.vfx-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.vfx-path{word-break:break-all;color:var(--color-subtle_text)}.vfx-columns{display:grid;grid-template-columns:190px 1fr;gap:20px}.vfx-list>div{display:flex;margin:6px 0}.vfx-list button{overflow-wrap:anywhere}.vfx-detail label,.vfx-particle label{display:flex;flex-direction:column;margin-bottom:12px;gap:4px}.vfx-detail select,.vfx-particle select{width:100%}.vfx-studio table{width:100%;margin:12px 0}.vfx-studio td{padding:6px;word-break:break-all}.vfx-particle{padding:12px;border-bottom:1px solid var(--color-border)}.vfx-message{white-space:pre-wrap;padding:12px}.vfx-list .selected{color:var(--color-accent)}' + `
        .vfx-sync p{margin:12px 0;line-height:1.5}.vfx-sync label{display:flex;flex-direction:column;gap:6px;margin:12px 0}.vfx-sync select{width:100%;min-width:0}.vfx-sync-files{max-height:45vh;overflow:auto}.vfx-sync table{table-layout:fixed;border-collapse:collapse}.vfx-sync th,.vfx-sync td{text-align:left;padding:8px;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere}.vfx-sync th:last-child{width:130px}
        .vfx-models{display:flex;flex-direction:column;gap:16px;min-width:0;line-height:1.5}
        .vfx-models p{margin:0}
        .vfx-models-header{display:grid;gap:6px;min-width:0}
        .vfx-models-status{font-weight:600}
        .vfx-models .vfx-path{font-size:.9em;overflow-wrap:anywhere;word-break:normal}
        .vfx-models-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
        .vfx-models-toolbar input.vfx-models-search{display:block;flex:1 1 260px;width:100%;min-width:0;max-width:100%;height:36px;padding:6px 10px;box-sizing:border-box;border:1px solid var(--color-border);border-radius:4px;background:var(--color-back);color:var(--color-text)}
        .vfx-models-toolbar input.vfx-models-search:focus{border-color:var(--color-accent)}
        .vfx-models button{flex:0 0 auto;margin:0;min-height:34px;height:auto;padding:6px 12px;line-height:1.4;white-space:normal}
        .vfx-models-list{display:grid;gap:14px;max-height:55vh;overflow-y:auto;min-width:0;padding:1px 6px 1px 1px}
        .vfx-model-card{min-width:0;padding:16px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-back)}
        .vfx-model-title{display:block;font-size:1.05em;overflow-wrap:anywhere}
        .vfx-models .vfx-model-meta{margin-top:4px;color:var(--color-subtle_text);font-size:.9em}
        .vfx-model-info{display:grid;grid-template-columns:76px minmax(0,1fr);gap:8px 12px;margin:14px 0}
        .vfx-model-info dt{color:var(--color-subtle_text)}
        .vfx-model-info dd{margin:0;min-width:0;overflow-wrap:anywhere}
        .vfx-model-file{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
        .vfx-model-file + .vfx-model-file{margin-top:6px}
        .vfx-model-file>span:first-child{min-width:0;overflow-wrap:anywhere}
        .vfx-model-count{color:var(--color-subtle_text);white-space:nowrap}
        .vfx-model-animations{margin:12px 0}
        .vfx-model-animations summary{display:list-item;list-style:disclosure-closed inside;cursor:pointer;padding:4px 0}
        .vfx-model-animations[open]>summary{list-style-type:disclosure-open}
        .vfx-model-animations ul{margin:6px 0 0;padding-left:20px;max-height:160px;overflow-y:auto}
        .vfx-model-animations li{overflow-wrap:anywhere;padding:2px 0}
        .vfx-model-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
        .vfx-models .vfx-model-hint,.vfx-models-empty{color:var(--color-subtle_text);padding:8px 0}
      `);
      const codec = AnimationCodec.codecs.bedrock;
      originalSaveAnimation = codec.saveAnimation;
      saveAnimationHook = function(animation) {
        const session = sessions.get(Project?.uuid);
        if (!session) return originalSaveAnimation.call(this, animation);
        studio = session.studio;
        return guard(() => capture({animations: [animation], model: false, texture: false}));
      };
      codec.saveAnimation = saveAnimationHook;
      for (const [id, name, icon, fn] of [
        ['import', '导入工程文件夹', 'folder_open', importProject],
        ['new_pack', '新建特效包', 'create_new_folder', createPack],
        ['models', '切换模型 / 打开其他模型', 'view_in_ar', showModelPicker],
        ['rescan', '重新扫描资产', 'refresh', rescan],
        ['sync_assets', '同步外部资产到特效包', 'drive_file_move', syncExternalAssets],
        ['update_runtime', '更新当前包的运行时资源', 'build', updateCurrentRuntime],
        ['manage', '资产与绑定', 'account_tree', showStudio],
        ['help', '使用说明', 'help_outline', showHelp],
        ['capture', '保存当前编辑回工程', 'save', capture],
        ['export', '导出到客户端', 'file_upload', exportClient]
      ]) {
        const action = new Action(`yesstevevfx_${id}`, {name, icon, click: () => guard(() => { activeStudio(); return fn(); })});
        actions.push(action);
      }
      menu = new BarMenu('yesstevevfx', actions, {name: 'VFX'});
      MenuBar.update();
    },
    onunload() {
      Blockbench.removeListener('undo', undoSyncListener);
      Blockbench.removeListener('redo', redoSyncListener);
      if (AnimationCodec.codecs.bedrock.saveAnimation === saveAnimationHook) AnimationCodec.codecs.bedrock.saveAnimation = originalSaveAnimation;
      dialog?.delete(); picker?.delete(); menu?.delete(); actions.forEach(action => action.delete()); MenuBar.update(); style?.delete(); sessions.clear();
    }
  });
})();
