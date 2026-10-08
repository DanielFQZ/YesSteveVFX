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
      if (rel === 'vfx-project.json' || (fs.existsSync(path.join(root, 'vfx-project.json')) && /^(?:models|animations|particles|textures|entity|render_controllers|assets\/eyelib\/[^/]+|effects)\/vfx_generated\//.test(rel))) continue;
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
        project.particles.push({key: rel, path: rel, id: json.particle_effect.description?.identifier || '', json, texture: '', lighting: /^eyelib:texture_unlit(?:_alpha|_add|_opaque)?$/.test(json.particle_effect.description?.basic_render_parameters?.material || '') ? 'texture' : 'source'});
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
    // Runtime exports before v0.2.2 emitted one geo file per effect. Those
    // files are byte-for-byte identical apart from their generated geometry
    // identifier. Collapse only that generated form while scanning, so an old
    // client pack remains convenient to edit and its entities still resolve to
    // the one canonical model entry.
    const modelAliases = new Map();
    const modelKeyAliases = new Map();
    if (manifest) {
      const seenGeometry = new Map();
      project.models = project.models.filter(model => {
        if (!(model.path.startsWith('models/') || model.path.startsWith('assets/eyelib/models/')) || !/^geometry\.yesstevevfx\./.test(model.id)) return true;
        const normalized = clone(model.geometry);
        if (normalized.description) normalized.description.identifier = '';
        const signature = JSON.stringify(normalized);
        const canonical = seenGeometry.get(signature);
        if (!canonical) { seenGeometry.set(signature, model); return true; }
        modelAliases.set(model.id, canonical.id);
        modelKeyAliases.set(model.key, canonical.key);
        return false;
      });
    }
    const renderControllers = [...documents.values()].flatMap(doc => Object.entries(doc.render_controllers || {}));
    const used = new Set();
    function addEffect(animation, definition, entity) {
      let name = definition?.id?.split(':').pop() || animation?.id?.split('.').pop() || 'effect';
      name = name.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
      if (!/[a-z0-9]/.test(name)) name = `effect_${project.effects.length + 1}`;
      const base = name; let index = 2;
      while (used.has(name)) name = `${base}_${index++}`;
      used.add(name);
      const geometryId = entity?.geometry?.default || Object.values(entity?.geometry || {})[0];
      const modelId = modelAliases.get(geometryId) || geometryId;
      const model = modelId ? uniqueMatch(project.models.filter(m => m.id === modelId)) : uniqueMatch(project.models);
      if (geometryId && !model) project.warnings.push(`模型引用无法唯一解析：${geometryId}，请明确选择模型。`);
      if (!geometryId && project.models.length > 1) project.warnings.push(`${animation?.id || name}：有多个候选模型，请在模型选择窗口关联动画。`);
      const texture = textureMatch(entity?.textures?.default || Object.values(entity?.textures || {})[0], project.textures);
      const controllerIds = (entity?.render_controllers || []).flatMap(ref => typeof ref === 'string' ? [ref] : Object.keys(ref));
      const controller = uniqueMatch(renderControllers.filter(([id]) => controllerIds.includes(id)))?.[1];
      const effect = {key: `effect_${project.effects.length + 1}`, enabled: true, name, animation: animation?.key || '', model: model?.key || '', texture,
        ignoreLighting: controller?.ignore_lighting ?? false,
        textureColor: Object.values(entity?.materials || {}).includes('eyelib:texture_unlit'),
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
      for (const effect of project.effects) if (effect.model) effect.model = modelKeyAliases.get(effect.model) || effect.model;
      for (const particle of project.particles) {
        particle.texture = config.particleTextures?.[particle.key] || particle.texture;
        particle.lighting = config.particleLighting?.[particle.key] ?? 'source';
      }
      for (const animation of project.animations) if (!project.effects.some(e => e.animation === animation.key)) {
        const model = uniqueMatch(project.models);
        const effect = makeEffect(project, animation, model?.key || '');
        effect.modelUnresolved = project.models.length > 1;
        effect.texture = modelTexture?.key || '';
        project.effects.push(effect);
      }
    }
    for (const effect of project.effects) {
      effect.ignoreLighting ??= false;
      effect.textureColor ??= false;
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
    project.audio = documents.get('audio.json') || {format_version: 1, sounds: {}, hit_bindings: []};
    return project;
  }
  const stableAlias = key => 'vfx_' + hash(key);
  function readableAssetStem(value, fallback = 'asset') {
    let stem = path.posix.basename(slash(String(value || '')).split('#')[0]);
    stem = stem.replace(/\.(?:geo|animation|particle)(?:\.json)?$/i, '').replace(/\.(?:png|json)$/i, '');
    // Names produced by older YesSteveVFX versions ended with _<12 hex chars>.
    // Do not carry that implementation detail into a newly exported package.
    const legacyName = /_[0-9a-f]{12}$/i.test(stem);
    stem = stem.replace(/(?:_[0-9a-f]{12}_*)+$/i, '');
    // Also normalize names from the old per-effect exporter, such as
    // model_<source>_geo_json_0_<hash>.geo.json.
    if (legacyName) {
      stem = stem.replace(/^model_(.+)_geo_json_\d+$/i, '$1');
      stem = stem.replace(/_(?:particle_)?(?:png|json|jso)$/i, '');
    }
    stem = stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[-._]+|[-._]+$/g, '');
    return (stem.match(/[A-Za-z0-9]/) ? stem : fallback).slice(0, 96).toLowerCase();
  }
  // Runtime package paths may contain UTF-8 file names (for example Chinese
  // sound names), but must remain relative and free of traversal/namespace
  // syntax. Generated identifiers are still ASCII and validated separately.
  function isSafeResourcePath(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 &&
      !value.includes('\\') && !value.includes(':') && !value.includes('\0') &&
      !value.split('/').some(part => !part || part === '.' || part === '..') &&
      !/[\u0000-\u001f\u007f]/.test(value);
  }
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
      const animationNames = new Set(animations.map(a => a.id));
      const hitBindings = (project.audio?.hit_bindings || []).filter(binding => animationNames.has(binding.animation));
      return {key: model.key, model, effects, filePaths, animations,
        files: filePaths.map(path => ({path, count: animations.filter(a => a.path === path).length})),
        particles: new Set(effects.flatMap(e => events(project.animations.find(a => a.key === e.animation)?.animation)
          .map(event => eventParticle(project, e, event)).filter(Boolean))).size,
        hitBindings,
        bones: model.geometry.bones?.length || 0,
        cubes: (model.geometry.bones || []).reduce((n, bone) => n + (bone.cubes?.length || 0), 0)};
    });
    const particleOnly = project.effects.filter(e => !e.model && !e.modelUnresolved);
    if (particleOnly.length) {
      const filePaths = [...new Set(particleOnly.map(e => project.animations.find(a => a.key === e.animation)?.path).filter(Boolean))];
      const animations = project.animations.filter(a => filePaths.includes(a.path));
      const animationNames = new Set(animations.map(a => a.id));
      views.push({key: '', model: null, effects: particleOnly, files: filePaths.map(path => ({path, count: animations.filter(a => a.path === path).length})), animations,
        hitBindings: (project.audio?.hit_bindings || []).filter(binding => animationNames.has(binding.animation)), bones: 0, cubes: 0});
    }
    return views;
  }
  function makeEffect(project, animation, model = '') {
    const base = (animation?.id.split('.').pop() || 'effect').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
    let name = /^[a-z0-9]/.test(base) ? base.slice(0, 80) : 'effect';
    const stem = name;
    for (let n = 2; project.effects.some(e => e.name === name); n++) name = `${stem}_${n}`;
    return {key: crypto.randomUUID(), name, enabled: true, model, modelUnresolved: false, texture: '', ignoreLighting: false, textureColor: false,
      animation: animation?.key || '', duration: Math.max(20, Math.ceil((animation?.animation.animation_length || 5) * 20) + 20),
      bindings: {}, eventBindings: {}};
  }
  function settings(project) {
    return {version: 2, packId: project.packId, displayName: project.displayName, effects: audioOnlyProject(project) ? [] : clone(project.effects),
      particleTextures: Object.fromEntries(project.particles.map(p => [p.key, p.texture])),
      particleLighting: Object.fromEntries(project.particles.map(p => [p.key, p.lighting ?? 'source']))};
  }
  function particleDocument(particle, runtime = true) {
    const mode = particle.lighting ?? 'source';
    if (!['source', 'ambient', 'unlit', 'texture'].includes(mode)) throw new Error(`${particle.path}：未知粒子光照模式 ${mode}`);
    const document = clone(particle.json);
    if (mode !== 'source') {
      const components = document.particle_effect.components ||= {};
      if (mode === 'ambient') components['minecraft:particle_appearance_lighting'] = {};
      else delete components['minecraft:particle_appearance_lighting'];
    }
    if (mode === 'texture') {
      const parameters = document.particle_effect.description.basic_render_parameters;
      const material = parameters.material || 'particles_alpha';
      const mapped = {particles_alpha: 'eyelib:texture_unlit_alpha', particles_blend: 'eyelib:texture_unlit',
        particles_add: 'eyelib:texture_unlit_add', particles_opaque: 'eyelib:texture_unlit_opaque', particles_base: 'eyelib:texture_unlit_opaque'};
      const name = material.replace(/^minecraft:/, '');
      if (Object.values(mapped).includes(material)) parameters.material = material;
      else if (mapped[name]) parameters.material = mapped[name];
      else throw new Error(`${particle.path}：原色模式不支持自定义粒子材质 ${material}，请选择跟随源 JSON`);
    }
    if (!runtime || mode === 'ambient' || mode === 'unlit') {
      const parameters = document.particle_effect.description.basic_render_parameters;
      const previewMaterials = {'eyelib:texture_unlit': 'particles_blend', 'eyelib:texture_unlit_alpha': 'particles_alpha',
        'eyelib:texture_unlit_add': 'particles_add', 'eyelib:texture_unlit_opaque': 'particles_opaque'};
      parameters.material = previewMaterials[parameters.material] || parameters.material;
    }
    return document;
  }
  function audioOnlyProject(project) {
    return Object.keys(project.audio?.sounds || {}).length > 0 &&
      project.models.length === 0 && project.animations.length === 0 && project.particles.length === 0;
  }
  function find(items, key, label) {
    const item = items.find(item => item.key === key);
    if (!item) throw new Error(`请选择${label}（${key || '未绑定'}）`);
    return item;
  }
  function validate(project, onlyEffect, options = {}) {
    const errors = [];
    const names = new Set();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(project.packId)) errors.push('包 ID 必须是 1–64 位小写字母、数字、点、横线或下划线，并以字母/数字开头');
    const audioOnly = !onlyEffect && audioOnlyProject(project);
    const effects = audioOnly ? [] : (onlyEffect ? [onlyEffect] : project.effects.filter(e => e.enabled));
    if (!effects.length && !Object.keys(project.audio?.sounds || {}).length && !options.allowEmpty) errors.push('至少启用一个特效');
    for (const effect of effects) {
      try {
        if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(effect.name)) throw new Error('特效名必须是合法 ASCII ID');
        if (names.has(effect.name)) throw new Error('特效名重复');
        names.add(effect.name);
        if (!Number.isInteger(Number(effect.duration)) || effect.duration < 1 || effect.duration > 72000) throw new Error('持续时间必须为 1–72000 tick');
        if (effect.ignoreLighting !== undefined && typeof effect.ignoreLighting !== 'boolean') throw new Error('模型全亮必须为布尔值');
        if (effect.textureColor !== undefined && typeof effect.textureColor !== 'boolean') throw new Error('模型贴图原色必须为布尔值');
        if (effect.modelUnresolved && !effect.model) throw new Error('模型关系未确认，请在模型与动画绑定中选择模型或明确设为仅粒子');
        const model = effect.model ? find(project.models, effect.model, '模型') : null;
        if (model) {
          find(project.textures, effect.texture, '模型贴图');
          validateModelUv(model.geometry, model.path);
        }
        const animation = effect.animation ? find(project.animations, effect.animation, '动画') : null;
        const timeKeys = Object.keys(animation?.animation.particle_effects || {});
        if (timeKeys.some(t => !Number.isFinite(Number(t))) || new Set(timeKeys.map(Number)).size !== timeKeys.length) throw new Error('粒子事件时间非法或重复（例如同时存在 0 和 0.0），请在源动画中合并该时间点');
        const locators = new Set((model?.geometry.bones || []).flatMap(bone => Object.keys(bone.locators || {})));
        for (const event of events(animation?.animation)) {
          const particle = find(project.particles, eventParticle(project, effect, event), `事件“${event.effect}”的粒子`);
          particleDocument(particle);
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
  function validateModelUv(geometry, file) {
    const {texture_width: width, texture_height: height} = geometry.description || {};
    if (![width, height].every(v => Number.isInteger(v) && v > 0)) throw new Error(`${file}：模型 UV 尺寸必须是正整数`);
    function checkBone(bone) {
      for (const cube of bone.cubes || []) {
        if (!Array.isArray(cube.uv) || !Array.isArray(cube.size)) continue;
        const [u, v] = cube.uv, [x, y, z] = cube.size;
        const right = u + 2 * (Math.abs(x) + Math.abs(z)), bottom = v + Math.abs(y) + Math.abs(z);
        if (![u, v, x, y, z, right, bottom].every(Number.isFinite) || u < 0 || v < 0 || right > width || bottom > height) {
          throw new Error(`${file}：骨骼 ${bone.name || '(未命名)'} 的方盒 UV 超出模型声明的 ${width}×${height}，需要至少 ${Math.ceil(right)}×${Math.ceil(bottom)}。请核对原始模型的 UV 尺寸，在 Blockbench 项目设置中修正并保存模型；PNG 像素尺寸不一定等于 UV 尺寸。向空工程导入模型可能只缩放逐面 UV，不能只改尺寸而忽略 UV 坐标。`);
        }
      }
      for (const child of bone.children || []) checkBone(child);
    }
    for (const bone of geometry.bones || []) checkBone(bone);
    const degenerate = inspectDegenerateModelUv(geometry, file);
    if (degenerate.length) {
      const first = degenerate[0];
      throw new Error(`${file}：检测到 ${degenerate.length} 个退化逐面 UV（${first.bone} / ${first.face} 的 uv_size 为 ${JSON.stringify(first.uvSize)}）。请使用 VFX → 检查/修复退化 UV，将 0 改为有效的正负像素范围。`);
    }
  }
  const UV_EPSILON = 0.000001;
  function uvSign(coordinate, extent) {
    if (Math.abs(coordinate - extent) <= UV_EPSILON) return -1;
    if (Math.abs(coordinate) <= UV_EPSILON) return 1;
    return coordinate > extent / 2 ? -1 : 1;
  }
  function inspectDegenerateModelUv(geometry, file = '', geometryIndex = 0) {
    const width = Number(geometry?.description?.texture_width);
    const height = Number(geometry?.description?.texture_height);
    const issues = [];
    function visitBone(bone, bonePath) {
      for (let cubeIndex = 0; cubeIndex < (bone.cubes || []).length; cubeIndex++) {
        const cube = bone.cubes[cubeIndex];
        // Bedrock geo files use cube.uv for per-face UVs.  The Blockbench
        // project representation used by some import paths calls the same
        // map cube.faces, so inspect both forms.
        const faceMap = cube.uv && typeof cube.uv === 'object' && !Array.isArray(cube.uv)
          ? cube.uv
          : (cube.faces && typeof cube.faces === 'object' ? cube.faces : {});
        for (const [face, value] of Object.entries(faceMap)) {
          if (!value || !Array.isArray(value.uv_size) || value.uv_size.length < 2) continue;
          const uv = Array.isArray(value.uv) ? value.uv : [];
          const uvSize = value.uv_size;
          const horizontal = Number(uvSize[0]);
          const vertical = Number(uvSize[1]);
          if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) ||
              (Math.abs(horizontal) > UV_EPSILON && Math.abs(vertical) > UV_EPSILON)) continue;
          const u = Number(uv[0]), v = Number(uv[1]);
          const replacement = [
            Math.abs(horizontal) <= UV_EPSILON && Number.isFinite(u) && Number.isFinite(width) && width > 0 ? uvSign(u, width) : uvSize[0],
            Math.abs(vertical) <= UV_EPSILON && Number.isFinite(v) && Number.isFinite(height) && height > 0 ? uvSign(v, height) : uvSize[1]
          ];
          issues.push({file, geometryIndex, geometryId: geometry?.description?.identifier || '', bone: bone.name || '(未命名)', bonePath,
            cube: cubeIndex, face, uv: Array.isArray(value.uv) ? [...value.uv] : [], uvSize: [...uvSize], replacement, value});
        }
      }
      for (let childIndex = 0; childIndex < (bone.children || []).length; childIndex++) {
        const child = bone.children[childIndex];
        visitBone(child, `${bonePath}/children[${childIndex}]`);
      }
    }
    for (let boneIndex = 0; boneIndex < (geometry?.bones || []).length; boneIndex++) {
      const bone = geometry.bones[boneIndex];
      visitBone(bone, `bones[${boneIndex}]`);
    }
    return issues;
  }
  function inspectProjectUv(project) {
    return (project?.models || []).flatMap(model => inspectDegenerateModelUv(model.geometry, model.path, model.index)
      .map(issue => ({...issue, modelKey: model.key})));
  }
  function repairDegenerateModelUv(project, options = {}) {
    const issues = inspectProjectUv(project);
    if (!issues.length) return {count: 0, files: [], backup: ''};
    for (const issue of issues) issue.value.uv_size = [...issue.replacement];
    const changedFiles = new Set(issues.map(issue => issue.file));
    let backup = '';
    if (options.write !== false) {
      backup = path.join(editBackupRoot(project.root), `uv-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
      for (const file of changedFiles) {
        const absolute = fileAt(project.root, file);
        if (fs.existsSync(absolute)) {
          const old = fileAt(backup, file); fs.mkdirSync(path.dirname(old), {recursive: true}); fs.copyFileSync(absolute, old);
        }
      }
      for (const file of changedFiles) {
        const absolute = fileAt(project.root, file);
        const document = readJson(absolute);
        for (const model of project.models.filter(candidate => candidate.path === file)) {
          if (document['minecraft:geometry']?.[model.index]) document['minecraft:geometry'][model.index] = model.geometry;
        }
        const temporary = absolute + '.uv.tmp';
        fs.writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n');
        fs.renameSync(temporary, absolute);
      }
      // Keep the scan cache and any open picker in sync with the source files.
      for (const model of project.models) {
        if (!changedFiles.has(model.path)) continue;
        model.geometry = readJson(fileAt(project.root, model.path))['minecraft:geometry'][model.index];
      }
    }
    return {count: issues.length, files: [...changedFiles], backup, issues};
  }
  function importedUvSize(model, occupied) {
    if (occupied || model?.meta?.model_format !== 'bedrock' || !model.elements?.length ||
        model.elements.some(e => e.type && e.type !== 'cube')) return null;
    const width = model.resolution?.width, height = model.resolution?.height;
    return [width, height].every(v => Number.isInteger(v) && v >= 1 && v <= 16384) ? {width, height} : null;
  }
  function planImportedUv(cubes, current, target) {
    if (![current.width, current.height, target.width, target.height].every(v => Number.isFinite(v) && v > 0)) throw new Error('无法自动同步：模型 UV 尺寸无效');
    // Blockbench's project merger scales per-face coordinates to the destination
    // canvas but leaves box UVs untouched. Restore only the scaled coordinates.
    return cubes.filter(c => !c.box_uv).flatMap(c => Object.values(c.faces).map(face => {
      if (!Array.isArray(face.uv) || face.uv.length !== 4 || !face.uv.every(Number.isFinite)) throw new Error('无法自动同步：模型逐面 UV 坐标无效');
      return {face, uv: face.uv.map((v, i) => v * (i % 2 ? target.height / current.height : target.width / current.width))};
    }));
  }
  function build(project, options = {}) {
    const errors = validate(project, undefined, options);
    if (errors.length) throw new Error(errors.join('\n'));
    const out = new Map();
    const json = (name, content) => out.set(name, Buffer.from(JSON.stringify(content, null, 2) + '\n'));
    const pack = project.packId;
    const resourcePack = options.generated ? `vfx_generated/${pack}` : pack;
    const runtimeNames = new Map();
    const runtimeUsed = new Map();
    const reservedNames = new Map();
    function runtimeName(kind, key, fallback) {
      const identity = `${kind}:${key}`;
      if (runtimeNames.has(identity)) return runtimeNames.get(identity);
      const used = runtimeUsed.get(kind) || new Set();
      const base = readableAssetStem(key, fallback);
      let name = base;
      for (let index = 2; used.has(name) || (name !== base && reservedNames.get(kind)?.has(name)); index++) name = `${base}_${index}`;
      used.add(name); runtimeUsed.set(kind, used); runtimeNames.set(identity, name);
      return name;
    }
    // Allocate in source-key order, independent of effect/list order. Reserve
    // natural names (e.g. smoke_2) before adding suffixes to duplicate smoke.
    function allocateNames(kind, keys, fallback) {
      const sorted = [...new Set(keys)].sort();
      reservedNames.set(kind, new Set(sorted.map(key => readableAssetStem(key, fallback))));
      sorted.forEach(key => runtimeName(kind, key, fallback));
    }
    runtimeUsed.set('textures', new Set(['empty']));
    allocateNames('models', project.models.map(m => m.key), 'model');
    allocateNames('textures', project.textures.map(t => t.key), 'texture');
    allocateNames('particles', project.particles.map(p => p.key), 'particle');
    const textureId = key => `yesstevevfx:textures/${resourcePack}/${runtimeName('textures', key, 'texture')}`;
    const particleId = key => `yesstevevfx:${resourcePack}/${runtimeName('particles', key, 'particle')}`;
    function putTexture(key) {
      const texture = find(project.textures, key, '贴图');
      const name = runtimeName('textures', key, 'texture');
      out.set(`textures/${resourcePack}/${name}.png`, fs.readFileSync(fileAt(project.root, texture.path)));
      return textureId(key);
    }
    // A source geometry is shared by all effects that reference the same
    // model/geometry entry.  Older exports wrote one identical geo file per
    // effect, which made an imported runtime pack look as if it contained
    // many separate models.  Keep one stable runtime geometry resource per
    // source model and let each entity point at that identifier.
    const geometryResources = new Map();
    function geometryResource(effect) {
      const sourceKey = effect.model || '__empty__';
      const existing = geometryResources.get(sourceKey);
      if (existing) return existing;
      const geometry = effect.model ? clone(find(project.models, effect.model, '模型').geometry) : emptyGeometry();
      const stem = runtimeName('models', effect.model || '__empty__', effect.model ? 'model' : 'empty');
      const base = `${options.generated ? 'vfx_generated.' : ''}${pack}.${stem}`;
      geometry.description.identifier = `geometry.yesstevevfx.${base}`;
      const file = `models/${resourcePack}/${stem}.geo.json`;
      json(file, {format_version: '1.12.0', 'minecraft:geometry': [geometry]});
      const resource = {id: geometry.description.identifier, file};
      geometryResources.set(sourceKey, resource);
      return resource;
    }
    const animationResources = new Map();
    function animationResource(effect) {
      const sourceKey = effect.model || '__empty__';
      const existing = animationResources.get(sourceKey);
      if (existing) return existing;
      const stem = runtimeName('models', effect.model || '__empty__', effect.model ? 'model' : 'empty');
      const resource = {file: `animations/${resourcePack}/${stem}.animation.json`, animations: {}};
      animationResources.set(sourceKey, resource);
      return resource;
    }
    const effectPaths = [];
    for (const effect of (audioOnlyProject(project) ? [] : project.effects.filter(e => e.enabled))) {
      const base = `${options.generated ? 'vfx_generated.' : ''}${pack}.${effect.name}`;
      const geometry = geometryResource(effect);
      // Preserve the translucent rendering previously supplied by eyelib's
      // fallback component, while using a real controller/material binding.
      const entity = {identifier: `yesstevevfx:${resourcePack}/${effect.name}`, materials: {default: effect.textureColor ? 'eyelib:texture_unlit' : 'entity_translucent'},
        geometry: {default: geometry.id}, textures: {}, particle_effects: {},
        render_controllers: [`controller.render.yesstevevfx.${base}`]};
      if (effect.model) entity.textures.default = putTexture(effect.texture);
      else {
        const key = `textures/${resourcePack}/empty`;
        entity.textures.default = `yesstevevfx:${key}`;
        out.set(`${key}.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
      }
      if (effect.animation) {
        const animation = clone(find(project.animations, effect.animation, '动画').animation);
        for (const event of events(animation)) {
          const particle = find(project.particles, eventParticle(project, effect, event), '粒子');
          const alias = stableAlias(particle.key);
          const particleName = runtimeName('particles', particle.key, 'particle');
          setEventAlias(animation, event, alias);
          entity.particle_effects[alias] = particleId(particle.key);
          const doc = particleDocument(particle);
          doc.particle_effect.description.identifier = particleId(particle.key);
          doc.particle_effect.description.basic_render_parameters.texture = putTexture(particle.texture);
          json(`particles/${resourcePack}/${particleName}.json`, doc);
        }
        const id = `animation.yesstevevfx.${base}`;
        const animations = animationResource(effect);
        animations.animations[id] = animation;
        entity.animations = {main: id}; entity.scripts = {animate: ['main']};
      }
      const entityPath = `entity/${resourcePack}/${effect.name}.json`;
      json(entityPath, {'minecraft:client_entity': {description: entity}});
      json(`render_controllers/${resourcePack}/${effect.name}.json`, {render_controllers: {
        [entity.render_controllers[0]]: {geometry: 'Geometry.default', materials: [{'*': 'Material.default'}], textures: ['Texture.default'], ignore_lighting: effect.ignoreLighting ?? false}
      }});
      const effectPath = `effects/${options.generated ? 'vfx_generated/' : ''}${effect.name}.json`;
      effectPaths.push(effectPath);
      json(effectPath, {format_version: 1, id: `${pack}:${effect.name}`, duration_ticks: Number(effect.duration), client_entity: entityPath});
    }
    for (const resource of animationResources.values()) {
      json(resource.file, {format_version: '1.8.0', animations: resource.animations});
    }
    const audio = audioDocument(project);
    if (Object.keys(audio.sounds).length || audio.hit_bindings.length) {
      json('audio.json', audio);
      for (const def of Object.values(audio.sounds)) out.set(def.file, fs.readFileSync(fileAt(project.root, def.file)));
    }
    json('manifest.json', {format_version: 1, pack_id: pack, display_name: project.displayName || pack, effects: effectPaths});
    if (out.size > 4096 || [...out.values()].reduce((n, b) => n + b.length, 0) > 128 * 1024 * 1024) throw new Error('导出包超过 VFX 的资源大小限制');
    for (const [name, bytes] of out) {
      if (!isSafeResourcePath(name) || bytes.length > 16 * 1024 * 1024) throw new Error(`导出资源路径或大小不合法：${name}`);
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
    const output = build(project, {generated: true, allowEmpty: true});
    const sources = new Set([...project.models, ...project.animations, ...project.particles, ...project.textures].map(a => a.path));
    for (const file of output.keys()) if (sources.has(file)) throw new Error('生成目录被当作源资产使用，请先调整源路径：' + file);
    output.set('vfx-project.json', Buffer.from(JSON.stringify(settings(project), null, 2) + '\n'));
    const all = new Map(filesIn(project.root).map(file => [file, fs.statSync(fileAt(project.root, file)).size]));
    // Renaming generated resources must not leave old animation IDs loaded a
    // second time. Only retire generated files owned by this pack, never sources.
    const obsolete = [...all.keys()].filter(file => !sources.has(file) && !output.has(file) &&
      ['models', 'animations', 'particles', 'textures', 'entity', 'render_controllers'].some(kind =>
        file.startsWith(`${kind}/vfx_generated/${project.packId}/`) ||
        file.startsWith(`assets/eyelib/${kind}/vfx_generated/${project.packId}/`)));
    for (const file of obsolete) all.delete(file);
    for (const [file, bytes] of output) all.set(file, bytes.length);
    if (all.size > 4096 || [...all.values()].reduce((a, b) => a + b, 0) > 128 * 1024 * 1024) throw new Error('生成后特效包会超过资源大小限制');
    const changed = [...output].filter(([file, bytes]) => !fs.existsSync(fileAt(project.root, file)) || !fs.readFileSync(fileAt(project.root, file)).equals(bytes));
    // Switch the manifest only after every dependency is in place.
    changed.sort(([a], [b]) => Number(a === 'manifest.json') - Number(b === 'manifest.json'));
    const backup = path.join(editBackupRoot(project.root), `runtime-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    const previous = new Map();
    for (const file of [...changed.map(([file]) => file), ...obsolete]) {
      const dest = fileAt(project.root, file);
      previous.set(file, fs.existsSync(dest) ? fs.readFileSync(dest) : null);
      if (previous.get(file)) {
        const old = fileAt(backup, file); fs.mkdirSync(path.dirname(old), {recursive: true}); fs.writeFileSync(old, previous.get(file));
      }
    }
    const written = [];
    try {
      for (const file of obsolete) {
        written.push(file); fs.unlinkSync(fileAt(project.root, file));
      }
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
    return {count: changed.length + obsolete.length, effects: project.effects.filter(e => e.enabled).length,
      backup: changed.length || obsolete.length ? backup : ''};
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
    const sourceName = (value, category, fallback) => {
      let name = path.basename(String(value || '').trim());
      name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
      name = name.replace(/\.(?:geo|animation)(?:\.json)?$/i, '').replace(/\.json$/i, '').trim();
      return `${name || fallback}.${category}.json`;
    };
    const modelFile = sourceName(options.modelFile, 'geo', 'model');
    const animationFile = sourceName(options.animationFile, 'animation', 'animation');
    const animationStem = path.basename(animationFile, '.animation.json');
    const animationSuffix = animationStem.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
    const animationName = `animation.${packId}.${/[a-z0-9]/.test(animationSuffix) ? animationSuffix : 'main'}`;
    const geometryStem = path.basename(modelFile, '.geo.json').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
    const geometrySuffix = /[a-z0-9]/.test(geometryStem) ? geometryStem : 'model';
    const geometry = emptyGeometry();
    // A render-only empty carrier uses 1x1. An editable project needs its own
    // declared UV canvas, independent of the PNG's physical resolution.
    const textureWidth = Number(options.textureWidth ?? 16), textureHeight = Number(options.textureHeight ?? 16);
    if (![textureWidth, textureHeight].every(v => Number.isInteger(v) && v >= 1 && v <= 16384)) throw new Error('模型 UV 尺寸必须为 1–16384 的整数');
    geometry.description.texture_width = textureWidth;
    geometry.description.texture_height = textureHeight;
    geometry.description.identifier = `geometry.${packId}.${geometrySuffix}`;
    const modelPath = `models/${modelFile}`;
    const animationPath = `animations/${animationFile}`;
    const previewEffect = {key: `effect_${packId}_preview`, name: `${packId}_preview`.slice(0, 96), enabled: true,
      model: `${modelPath}#0`, modelUnresolved: false, texture: '', animation: `${animationPath}#${animationName}`,
      duration: 20, bindings: {}, eventBindings: {}};
    const root = path.join(parent, packId);
    if (fs.existsSync(root)) throw new Error(`目标目录已存在：${root}`);
    fs.mkdirSync(root, {recursive: true});
    for (const dir of ['effects', 'models', 'animations', 'particles', 'entity', 'render_controllers',
      'textures', 'sounds']) fs.mkdirSync(path.join(root, dir), {recursive: true});
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      format_version: 1, pack_id: packId, display_name: displayName, effects: []
    }, null, 2) + '\n');
    fs.mkdirSync(path.dirname(path.join(root, modelPath)), {recursive: true});
    fs.mkdirSync(path.dirname(path.join(root, animationPath)), {recursive: true});
    fs.writeFileSync(path.join(root, modelPath), JSON.stringify({format_version: '1.12.0', 'minecraft:geometry': [geometry]}, null, 2) + '\n');
    fs.writeFileSync(path.join(root, animationPath), JSON.stringify({format_version: '1.8.0', animations: {
      [animationName]: {animation_length: 1}
    }}, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'vfx-project.json'), JSON.stringify({
      version: 1, packId, displayName, effects: [previewEffect], particleTextures: {}
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
    function cleanAssetName(name, extension) {
      const original = path.basename(name || 'asset');
      const stem = path.basename(original, path.extname(original)).replace(/_[0-9a-f]{12}$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'asset';
      return `${stem.slice(0, 120)}${extension}`;
    }
    function put(source, bytes, kind, extension, name, canonicalize = (_target, raw) => raw, allowEmpty = false) {
      if (bytes.length > 16 * 1024 * 1024 || (!bytes.length && !allowEmpty)) throw new Error('资产为空或超过 16 MiB：' + source);
      if (kind === 'textures' && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('贴图必须为 PNG：' + source);
      const base = `${kind}/${cleanAssetName(name || source, extension)}`;
      let target = base, index = 2;
      while (true) {
        const canonical = canonicalize(target, bytes);
        const existing = fs.existsSync(fileAt(project.root, target)) ? read(fileAt(project.root, target)) : null;
        const planned = plan.files.get(target);
        if ((!existing || existing.equals(canonical)) && (!planned || planned.equals(canonical))) {
          const reused = !!existing || !!planned;
          plan.expected.set(target, canonical);
          if (!reused) plan.files.set(target, canonical);
          plan.rows.push({source, target, kind, status: reused ? '复用已有文件' : '复制到包内'});
          return target;
        }
        const suffix = `_${index++}`;
        target = `${kind}/${path.basename(base, extension)}${suffix}${extension}`;
      }
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
        target = put(item.source, Buffer.alloc(0), 'particles', '.json', path.basename(item.source), candidate => {
          const normalized = clone(json);
          normalized.particle_effect.description.identifier = `yesstevevfx:${project.packId}/particles/${token(candidate)}`;
          normalized.particle_effect.description.basic_render_parameters.texture = targetTexture.replace(/\.png$/i, '');
          if (normalized.particle_effect.description.preview_texture) delete normalized.particle_effect.description.preview_texture;
          return Buffer.from(JSON.stringify(normalized, null, 2) + '\n');
        }, true);
        json.particle_effect.description.identifier = `yesstevevfx:${project.packId}/particles/${token(target)}`;
        json.particle_effect.description.basic_render_parameters.texture = targetTexture.replace(/\.png$/i, '');
        if (json.particle_effect.description.preview_texture) delete json.particle_effect.description.preview_texture;
      }
      plan.particles.push({source: item.source, target, texture: targetTexture, json});
    }
    for (const source of [...new Set(input.animations || [])]) {
      if (inside(project.root, source)) continue;
      const bytes = read(source), json = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (!json.animations || typeof json.animations !== 'object' || Array.isArray(json.animations)) throw new Error('不是有效的动画文件：' + source);
      const target = put(source, bytes, 'animations', '.json', path.basename(source));
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
      const index = next.particles.findIndex(particle => particle.key === p.target);
      const entry = {key: p.target, path: p.target, id: p.json.particle_effect.description.identifier || '', json: p.json, texture: p.texture,
        lighting: next.particles[index]?.lighting ?? 'source'};
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
  // Keep the last directory used by each VFX workflow in Blockbench's
  // persistent StateMemory.  Blockbench's own resource_id remembers only the
  // parent directory, while VFX users commonly reopen the exact pack folder.
  // The small in-memory fallback also keeps these helpers usable in the Node
  // test harness where Blockbench is not present.
  const RECENT_PATHS_KEY = 'yesstevevfx_recent_paths';
  const recentPathCache = {};
  function recentPaths() {
    if (typeof StateMemory !== 'undefined') {
      let value;
      try { value = StateMemory.get(RECENT_PATHS_KEY); } catch (_) { value = undefined; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        try { StateMemory.init(RECENT_PATHS_KEY, 'object', {}); } catch (_) { /* older BB builds */ }
        try { value = StateMemory.get(RECENT_PATHS_KEY); } catch (_) { value = undefined; }
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return recentPathCache;
  }
  function recentPath(kind) {
    const value = recentPaths()[kind];
    if (typeof value !== 'string' || !value) return '';
    let candidate = path.resolve(value);
    // A removed pack should not make Electron reject the dialog's defaultPath;
    // walk up to the nearest existing directory instead.
    while (!fs.existsSync(candidate)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) return '';
      candidate = parent;
    }
    try { return fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate); }
    catch (_) { return ''; }
  }
  function rememberPath(kind, value) {
    if (typeof kind !== 'string' || !kind || typeof value !== 'string' || !value) return '';
    const resolved = path.resolve(value);
    const paths = recentPaths();
    paths[kind] = resolved;
    try {
      if (typeof StateMemory !== 'undefined') StateMemory.save(RECENT_PATHS_KEY);
    } catch (_) { /* StateMemory is optional in tests/older builds */ }
    return resolved;
  }
  function molang(project, effect, slot = 'main', fixed = false) {
    if (!project || !effect || !project.packId || !effect.name) return '';
    const quote = value => String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    return `ctrl.${fixed ? 'vfx_play_fixed' : 'vfx_play'}('${quote(project.packId)}:${quote(effect.name)}', '${quote(slot)}');`;
  }
  function inspectOgg(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024) throw new Error('OGG 文件不能超过 4 MiB');
    let pos = 0, serial, seq = 0, ended = false, rate = 0, last = 0n;
    while (pos < bytes.length) {
      if (ended || pos + 27 > bytes.length || bytes.toString('ascii', pos, pos + 4) !== 'OggS' || bytes[pos + 4] !== 0) throw new Error('OGG 文件损坏或不完整');
      const flags = bytes[pos + 5], segments = bytes[pos + 26];
      if (pos + 27 + segments > bytes.length) throw new Error('OGG 分段表不完整');
      let size = 27 + segments;
      for (let i = 0; i < segments; i++) size += bytes[pos + 27 + i];
      if (pos + size > bytes.length) throw new Error('OGG 数据不完整');
      const stream = bytes.readUInt32LE(pos + 14);
      if (pos === 0) {
        serial = stream;
        const at = pos + 27 + segments;
        if (!(flags & 2) || at + 16 > pos + size || bytes[at] !== 1 || bytes.toString('ascii', at + 1, at + 7) !== 'vorbis') throw new Error('仅支持 OGG Vorbis 编码');
        if (bytes[at + 11] !== 1) throw new Error('位置音效需要单声道，请先将立体声音频转换为单声道');
        rate = bytes.readUInt32LE(at + 12);
        if (rate < 8000 || rate > 96000) throw new Error('采样率需要在 8000–96000 Hz 之间');
      }
      if (serial !== stream || bytes.readUInt32LE(pos + 18) !== seq++) throw new Error('不支持拼接的 OGG 音轨');
      let crc = 0;
      for (let i = 0; i < size; i++) {
        crc ^= ((i >= 22 && i < 26) ? 0 : bytes[pos + i]) << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
      }
      if ((crc >>> 0) !== bytes.readUInt32LE(pos + 22)) throw new Error('OGG 校验和错误');
      const granule = bytes.readBigInt64LE(pos + 6); if (granule >= 0n) last = granule;
      ended = !!(flags & 4); pos += size;
    }
    if (!ended || !rate || last <= 0n) throw new Error('OGG 缺少有效结束标记');
    const duration = Number(last) / rate;
    if (duration > 10) throw new Error('短音效不能超过 10 秒');
    return {duration, rate};
  }
  function audioDocument(project) {
    const audio = clone(project.audio || {format_version: 1, sounds: {}, hit_bindings: []});
    const fields = (object, allowed) => {
      if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('音效配置需要是对象');
      for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new Error('未知音效字段：' + key);
    };
    fields(audio, ['format_version', 'sounds', 'hit_bindings']);
    if (audio.format_version !== 1 || !audio.sounds || typeof audio.sounds !== 'object' || Array.isArray(audio.sounds)) throw new Error('audio.json 格式错误');
    if (audio.hit_bindings === undefined) audio.hit_bindings = [];
    if (!Array.isArray(audio.hit_bindings)) throw new Error('命中绑定需要是数组');
    if (Object.keys(audio.sounds).length > 1024 || audio.hit_bindings.length > 4096) throw new Error('音效或命中绑定数量超限');
    for (const [id, def] of Object.entries(audio.sounds)) {
      fields(def, ['file', 'volume', 'pitch', 'range', 'follow']);
      if (!/^yesstevevfx:[a-z0-9_./-]+$/.test(id) || id.includes('..') || id.includes('//') || id.endsWith('/') || id.startsWith('yesstevevfx:/')) throw new Error('音效 ID 不合法：' + id);
      if (typeof def.file !== 'string' || !isSafeResourcePath(def.file) ||
          !(def.file.startsWith('sounds/') || def.file.startsWith('assets/yesstevevfx/sounds/')) ||
          !def.file.endsWith('.ogg')) throw new Error('音效需要位于 sounds/*.ogg');
      inspectOgg(fs.readFileSync(fileAt(project.root, def.file)));
      for (const [field, fallback, min, max] of [['volume', 1, 0, 1], ['pitch', 1, .5, 2], ['range', 24, 1, 64]]) {
        if (def[field] === undefined) def[field] = fallback;
        if (typeof def[field] !== 'number' || !Number.isFinite(def[field]) || def[field] < min || def[field] > max) throw new Error(`${id}：${field} 必须为 ${min}–${max}`);
      }
      if (def.follow === undefined) def.follow = false;
      if (typeof def.follow !== 'boolean') throw new Error('follow 必须为布尔值');
    }
    const selectors = new Set();
    for (const h of audio.hit_bindings) {
      fields(h, ['model_id', 'animation', 'segment_index', 'sound']);
      if (![h.model_id, h.animation, h.sound].every(s => typeof s === 'string' && s.trim() && s.length <= 512) || !Number.isInteger(h.segment_index) || h.segment_index < 0 || h.segment_index > 65535 || !audio.sounds[h.sound]) throw new Error('命中绑定需要模型 ID、动画名、有效段下标和包内音效');
      const key = JSON.stringify([h.model_id, h.animation, h.segment_index]);
      if (selectors.has(key)) throw new Error('同一模型/动画/判定段不能重复绑定音效'); selectors.add(key);
    }
    return audio;
  }
  function saveAudio(project) {
    const audio = audioDocument(project);
    const target = path.join(project.root, 'audio.json');
    if (fs.existsSync(target)) {
      const backup = path.join(editBackupRoot(project.root), `audio-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
      fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.copyFileSync(target, backup);
    }
    fs.writeFileSync(target + '.tmp', JSON.stringify(audio, null, 2) + '\n');
    fs.renameSync(target + '.tmp', target); project.audio = audio;
  }
  function importAudio(project, source) {
    const bytes = fs.readFileSync(source); inspectOgg(bytes);
    const stem = path.basename(source, path.extname(source)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'sound';
    let rel = `sounds/${stem}.ogg`;
    for (let n = 2; fs.existsSync(fileAt(project.root, rel)) && !fs.readFileSync(fileAt(project.root, rel)).equals(bytes); n++) rel = `sounds/${stem}_${n}.ogg`;
    const idStem = stem.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'sound';
    const base = `yesstevevfx:${project.packId}/${idStem}`;
    const candidate = {...project, audio: clone(project.audio || {format_version: 1, sounds: {}, hit_bindings: []})};
    let id = base; for (let n = 2; candidate.audio.sounds[id]; n++) id = `${base}_${n}`;
    fs.mkdirSync(path.dirname(fileAt(project.root, rel)), {recursive: true});
    if (!fs.existsSync(fileAt(project.root, rel))) fs.writeFileSync(fileAt(project.root, rel), bytes, {flag: 'wx'});
    candidate.audio.sounds[id] = {file: rel, volume: 1, pitch: 1, range: 24, follow: false};
    saveAudio(candidate); project.audio = candidate.audio; return id;
  }
  const Core = {particleDocument, inspectOgg, audioDocument, saveAudio, importAudio, scan, settings, validate, build, exportPack, saveSettings, createEmptyPack, modelViews, makeEffect, captureBindings, eventParticle, stableAlias, setEventAlias, events, fileAt, token, emptyGeometry, particleTextureFile, planAssetSync, applyAssetSync, publishRuntime, editBackupRoot, recentPath, rememberPath, molang, importedUvSize, planImportedUv, inspectDegenerateModelUv, inspectProjectUv, repairDegenerateModelUv};
  if (typeof Blockbench === 'undefined') { module.exports = Core; return; }

  // Desktop UI is below; the import/export core is also exercised by Node tests.
  let studio = null, dialog = null, style = null, molangStyle = null, menu = null;
  const actions = [];
  let originalSaveAnimation = null, saveAnimationHook = null;
  let originalMergeProject = null, mergeProjectHook = null;
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
  function pickRecentDirectory(kind, title) {
    const options = {title};
    const startpath = recentPath(kind);
    if (startpath) options.startpath = startpath;
    const selected = Blockbench.pickDirectory(options);
    if (selected) rememberPath(kind, selected);
    return selected;
  }
  function copyMolangText(project, effect, fixed = false) {
    const text = molang(project, effect, 'main', fixed);
    if (!text) throw new Error('当前没有可复制的特效 Molang');
    if (typeof Clipbench !== 'undefined' && typeof Clipbench.setText === 'function') Clipbench.setText(text);
    else if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
    else throw new Error('Blockbench 当前环境不支持剪贴板');
    Blockbench.showQuickMessage('Molang 已复制，可粘贴到 YSM 指令帧。', 2500);
  }
  const redoSyncListener = ({entry}) => guard(() => restoreSyncState(entry, 'after'));
  let picker = null;
  function activeStudio() {
    const session = sessions.get(Project?.uuid);
    if (session && ModelProject.all.includes(session.project)) studio = session.studio;
    return studio;
  }
  function repairProjectUv() {
    if (!studio) throw new Error('请先打开特效包');
    const issues = inspectProjectUv(studio);
    if (!issues.length) {
      Blockbench.showQuickMessage('已检查全部 geo 模型，没有发现退化 UV。', 3500);
      return;
    }
    const result = repairDegenerateModelUv(studio, {write: true});
    const details = result.issues.slice(0, 24).map(issue =>
      `${issue.file} · geometry #${issue.geometryIndex} · ${issue.bone} · ${issue.face}：${JSON.stringify(issue.uvSize)} → ${JSON.stringify(issue.replacement)}`);
    const suffix = result.issues.length > details.length ? `\n……其余 ${result.issues.length - details.length} 个已修复` : '';
    Blockbench.showMessageBox({title: '退化 UV 已修复', message:
      `已扫描全部模型并修复 ${result.count} 个逐面 UV。\n\n${details.join('\n')}${suffix}\n\n源文件备份：${result.backup}\n请重新打开对应模型标签，或使用 VFX → 重新扫描资产。`});
    picker?.delete();
    showModelPicker();
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
      const textureStart = recentPath('sync_particle_texture');
      const form = Object.fromEntries(plan.missing.map((source, index) => ['texture_' + index,
        {label: '粒子贴图：' + source, type: 'file', extensions: ['png'], filetype: 'PNG 贴图', readtype: 'none', value: textureStart}]));
      new Dialog({id: 'vfx_sync_textures', title: '请选择未找到的粒子贴图', width: 850, form,
        onConfirm(values) { guard(() => {
          plan.missing.forEach((source, i) => {
            if (!values['texture_' + i]) throw new Error('尚未指定贴图：' + source);
            const selected = values['texture_' + i];
            input.particles.find(p => p.source === source).texture = selected;
            if (typeof selected === 'string') rememberPath('sync_particle_texture', path.dirname(selected));
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
          <p>复制当前标签引用的粒子、贴图和外部动画，保留外部原文件。外部资产默认写入 <code>particles</code>、<code>textures</code> 和 <code>animations</code>；相同内容可复用，同名不同内容会使用 <code>_2</code>、<code>_3</code> 等数字后缀。旧包仍可继续编辑。</p>
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
    const document = particleDocument(particle, false);
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
        data: {views: modelViews(studio).map(view => {
          let uvError = '';
          let uvIssues = [];
          if (view.model) try { validateModelUv(view.model.geometry, view.model.path); } catch (error) { uvError = error.message; }
          if (view.model) uvIssues = inspectDegenerateModelUv(view.model.geometry, view.model.path, view.model.index);
          return {...view, uvError, uvIssues};
        }), search: '', root: studio.root,
          counts: {models: studio.models.length, animations: studio.animations.length, particles: studio.particles.length}},
        computed: {filtered() { return this.views.filter(v => JSON.stringify([v.model?.path, v.model?.id, v.effects.map(e => e.name)]).toLowerCase().includes(this.search.toLowerCase())); }, degenerateUvCount() { return this.views.reduce((count, view) => count + view.uvIssues.length, 0); }},
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
            <p class="vfx-model-uv-error" v-if="degenerateUvCount">整个工程检测到 {{degenerateUvCount}} 个退化逐面 UV，请使用 VFX → 检查/修复退化 UV。</p>
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
              <p class="vfx-model-meta" v-if="v.model">模型 UV：{{v.model.geometry.description.texture_width}} × {{v.model.geometry.description.texture_height}}（独立于 PNG 分辨率）</p>
              <p class="vfx-model-uv-error" v-if="v.uvError">{{v.uvError}}</p>
              <p class="vfx-model-uv-error" v-if="v.uvIssues.length">检测到 {{v.uvIssues.length}} 个退化逐面 UV；导出前请使用 VFX → 检查/修复退化 UV。</p>
              <dl class="vfx-model-info">
                <template v-if="v.model"><dt>模型标识</dt><dd>{{v.model.id}}</dd></template>
                <dt>特效</dt><dd>{{v.effects.map(e => e.name).join('、') || '尚未关联'}}</dd>
                <dt>动画文件</dt><dd><div class="vfx-model-file" v-for="f in v.files" :key="f.path"><span>{{f.path}}</span><span class="vfx-model-count">{{f.count}} 个动画</span></div><span v-if="!v.files.length">尚未关联</span></dd>
                <dt v-if="v.model">粒子</dt><dd v-if="v.model">{{v.particles || 0}} 个已绑定</dd>
                <dt>音效</dt><dd><template v-if="v.hitBindings.length"><span v-for="(h,i) in v.hitBindings" :key="i" class="vfx-model-audio-row"><code>{{h.sound}}</code><small>· {{h.animation}} · 第 {{h.segment_index + 1}} 段 · YSM: {{h.model_id}}</small></span></template><span v-else>暂无 YSM 命中绑定（Molang 音效在动画指令帧中配置）</span></dd>
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
      if (session.project.saved === false) throw new Error(`标签“${session.project.name}”有未保存的模型修改，请先点击“保存当前编辑回工程”再导出。`);
      if (session.textureObject?.saved === false) throw new Error(`标签“${session.project.name}”有未保存的贴图修改，请先点击“保存当前编辑回工程”再导出。`);
    }
    refreshSavedAnimations();
    const result = exportPack(studio, parent);
    Blockbench.showMessageBox({title: 'VFX 导出完成', message: `${result.count} 个文件已写入：\n${result.target}\n\n在游戏执行 /vfx_client reload。${result.backup ? '\n旧包备份：' + result.backup : ''}`});
  }
  function exportClient() {
    const root = pickRecentDirectory('client_root', '选择 .minecraft 或启用版本隔离的版本目录');
    if (!root) return;
    const versionsPath = path.join(root, 'versions');
    if (fs.existsSync(versionsPath)) {
      const versions = fs.readdirSync(versionsPath, {withFileTypes: true}).filter(e => e.isDirectory());
      const choices = {root: '公共 .minecraft（未启用版本隔离）'};
      versions.forEach((v, i) => choices[`v${i}`] = `版本目录：${v.name}`);
      const rememberedTarget = recentPath('client_target');
      const defaultTarget = rememberedTarget === path.resolve(root) ? 'root' :
        (versions.map((v, i) => [path.resolve(path.join(versionsPath, v.name)), `v${i}`]).find(([dir]) => dir === rememberedTarget)?.[1] || 'root');
      new Dialog({id: 'vfx_target', title: '选择客户端实例', form: {target: {label: '写入位置', type: 'select', options: choices, value: defaultTarget}},
        onConfirm(values) { this.hide(); guard(() => {
          const target = values.target === 'root' ? root : path.join(versionsPath, versions[Number(values.target.slice(1))].name);
          rememberPath('client_target', target);
          exportTo(path.join(target, 'config', 'yesstevevfx', 'packs'));
        }); }}).show();
    } else {
      rememberPath('client_target', root);
      exportTo(path.join(root, 'config', 'yesstevevfx', 'packs'));
    }
  }
  function createPack() {
    const parent = pickRecentDirectory('new_pack_parent', '选择新特效包的父目录');
    if (!parent) return;
    new Dialog({id: 'vfx_new_pack', title: '新建 YesSteveVFX 特效包', width: 620,
      form: {
        packId: {label: '包 ID', description: '用于资源 ID，只允许英文、数字、点、横线和下划线。', type: 'text', value: 'new_pack'},
        displayName: {label: '显示名称', description: '显示名称可以使用中文。', type: 'text', value: '新特效包'},
        modelFile: {label: '初始模型文件名', description: '支持中文；可填写 .geo 或 .geo.json，插件会自动规范后缀。', type: 'text', value: 'model'},
        animationFile: {label: '初始动画文件名', description: '支持中文；可填写 .animation 或 .animation.json，插件会自动规范后缀。', type: 'text', value: 'animation'},
        textureWidth: {label: '模型 UV 宽度', description: '导入已有模型前请填写原工程的 UV 宽度，不一定等于 PNG 像素宽度。', type: 'number', value: 16, min: 1, max: 16384},
        textureHeight: {label: '模型 UV 高度', description: '应与原模型 texture_height 一致；导入后改尺寸可能还需修复 UV 坐标。', type: 'number', value: 16, min: 1, max: 16384},
        open: {label: '创建后立即打开工程', type: 'checkbox', value: true}
      },
      onConfirm(values) {
        this.hide();
        guard(() => {
          const root = createEmptyPack(parent, values);
          if (values.open !== false) {
            if (studio) {
              // A previously opened source folder may have been moved or deleted
              // outside Blockbench. Do not let its stale path prevent creating a
              // new pack.
              if (fs.existsSync(studio.root)) saveSettings(studio);
              else studio = null;
            }
            studio = scan(root);
            const starter = studio.effects.find(effect => effect.enabled) || studio.effects[0];
            if (starter) preview(starter, {allowIncomplete: true});
            else showModelPicker();
            Blockbench.showQuickMessage('特效包已创建，已打开初始 geo 模型和动画。', 4000);
          } else {
            Blockbench.showMessageBox({title: '特效包已创建', message: `已创建特效包：\n${root}\n\n已生成可直接打开的空模型和动画文件。文件名由你填写，插件自动规范为 .geo.json 和 .animation.json。`});
          }
        });
      }
    }).show();
  }
  let audioPreview = null, audioPreviewUrl = null, audioDialog = null;
  function stopAudioPreview() {
    if (audioPreview) audioPreview.pause(); audioPreview = null;
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl); audioPreviewUrl = null;
  }
  function showAudio() {
    if (!studio) throw new Error('请先导入或新建特效包');
    const project = studio;
    const rows = Object.entries(project.audio?.sounds || {}).map(([id, def]) => ({id, ...def}));
    const hits = clone(project.audio?.hit_bindings || []);
    function applyRows() {
      const sounds = {};
      for (const {id, ...def} of rows) {
        if (sounds[id]) throw new Error('音效 ID 重复：' + id); sounds[id] = def;
      }
      const candidate = {...project, audio: {format_version: 1, sounds, hit_bindings: hits}};
      saveAudio(candidate); project.audio = candidate.audio;
    }
    audioDialog?.delete();
    audioDialog = new Dialog({id: 'yesstevevfx_audio', title: 'VFX · 音效', width: 960, singleButton: true,
      onConfirm() { stopAudioPreview(); },
      onCancel() { stopAudioPreview(); },
      component: {data: {rows, hits, message: '修改后点击保存。命中绑定会写入 audio.json，并由安装了新版本 YSS 与 VFX 的服务端广播。'}, computed: {
        animations() { return [...new Set(project.animations.map(a => a.id).filter(Boolean))]; }
      }, methods: {
        save() { guard(() => { applyRows(); this.message = 'audio.json 已保存。游戏内执行 /vfx_client reload。'; }); },
        add() {
          guard(() => { applyRows();
          Blockbench.import({extensions: ['ogg'], type: 'OGG Vorbis', multiple: true, readtype: 'binary', startpath: recentPath('audio_import')}, files => guard(() => {
            for (const file of files) { importAudio(project, file.path); rememberPath('audio_import', path.dirname(file.path)); }
            stopAudioPreview(); audioDialog.hide(); showAudio();
          })); });
        },
        remove(i) { rows.splice(i, 1); this.message = '已从列表移除，保存后生效；原音频文件保留。'; },
        preview(r) { guard(() => {
          stopAudioPreview();
          audioPreviewUrl = URL.createObjectURL(new Blob([fs.readFileSync(fileAt(project.root, r.file))], {type: 'audio/ogg'}));
          audioPreview = new Audio(audioPreviewUrl); audioPreview.volume = Math.max(0, Math.min(1, r.volume)); audioPreview.playbackRate = r.pitch;
          audioPreview.play().catch(errorBox);
        }); },
        stopPreview() { stopAudioPreview(); },
        script(r) { return `ctrl.vfx_sound_play('${r.id}', 'swing');`; },
        copy(r, stop) { guard(() => {
          applyRows();
          const text = stop ? "ctrl.vfx_sound_stop('swing');" : this.script(r);
          if (typeof Clipbench !== 'undefined' && Clipbench.setText) Clipbench.setText(text); else navigator.clipboard.writeText(text);
          Blockbench.showQuickMessage('Molang 已复制，粘贴到 YSM 动画指令帧。', 2500);
        }); },
        addHit() { hits.push({model_id: '', animation: '', segment_index: 0, sound: rows[0]?.id || ''}); }
      }, template: `<div class="vfx-studio vfx-audio">
        <div class="vfx-toolbar"><button @click="add">导入 OGG</button><button @click="save">保存音效配置</button><button @click="stopPreview">停止试听</button></div>
          <p>单声道 OGG Vorbis，最长 10 秒。技能演出/挥刀音效推荐复制 Molang 到 YSM 动画指令帧；下面的 YSS 绑定只用于服务端确认“实际命中”后播放。</p>
        <section class="vfx-audio-panel">
          <div class="vfx-audio-panel-heading"><strong>音效列表</strong><span>{{rows.length}} 个音效</span></div>
          <div class="vfx-audio-list"><section v-for="(r,i) in rows" class="vfx-audio-card">
            <label>音效 ID<input v-model="r.id" type="text"></label><p class="vfx-path">{{r.file}}</p>
            <div class="vfx-audio-fields"><label>音量<input type="number" min="0" max="1" step=".1" v-model.number="r.volume"></label><label>音高<input type="number" min=".5" max="2" step=".1" v-model.number="r.pitch"></label><label>距离（格）<input type="number" min="1" max="64" v-model.number="r.range"></label><label>跟随实体<input type="checkbox" v-model="r.follow"></label></div>
            <div class="vfx-toolbar"><button @click="preview(r)">试听</button><button @click="copy(r,false)">复制播放指令</button><button @click="copy(r,true)">复制停止指令</button><button @click="remove(i)">移除</button></div><code>{{script(r)}}</code>
          </section><p v-if="!rows.length" class="vfx-audio-empty">暂无音效，点击“导入 OGG”开始。</p></div>
        </section>
        <section class="vfx-audio-panel vfx-audio-hit-panel">
          <div class="vfx-audio-panel-heading"><strong>YSS 命中绑定</strong><span>{{hits.length}} 条绑定 · 服务端确认后播放</span></div>
          <div class="vfx-audio-help vfx-audio-yss-guide"><strong>字段来源</strong><br><code>模型 ID</code> 来自 YSM 当前模型的 <code>displayPath</code>（YSM 对外的模型 ID），YSS 只使用这个值查找对应的 <code>hit.json</code>，不是 YSS 自己生成的 ID，也不是本窗口显示的 Bedrock geometry 标识；<code>动画名称</code> 是 YSM 动画名，同时也是 YSS 工程 <code>hit.json → animations</code> 的键；<code>段下标</code> 是该动画 <code>segments</code> 数组的下标，从 0 开始。YSS 的工程目录可能使用这个路径的归一化名称，但绑定值应以 YSM 运行时的 displayPath 为准。当前版本按这三个值精确匹配，不能填写 VFX geometry ID 或随意的显示名称。</div>
          <button @click="addHit">添加精确命中绑定</button>
          <datalist id="vfx_yss_animations"><option v-for="id in animations" :value="id"></option></datalist>
          <div class="vfx-audio-hit-list"><div v-for="(h,i) in hits" class="vfx-audio-card"><label>YSM 模型 ID（displayPath）<input v-model="h.model_id" placeholder="从 YSM 当前模型获取，例如 鸣潮/女漂 (1)"></label><label>YSM 动画名称<input v-model="h.animation" list="vfx_yss_animations" placeholder="YSM 动画名 / hit.json → animations 的键"></label><label>YSS 判定段下标<input type="number" min="0" max="65535" v-model.number="h.segment_index"></label><label>命中音效<select v-model="h.sound"><option v-for="r in rows" :value="r.id">{{r.id}}</option></select></label><button @click="hits.splice(i,1)">删除绑定</button></div><p v-if="!hits.length" class="vfx-audio-empty">暂无精确命中绑定。多数技能音效可直接使用上方 Molang 指令，不需要填写这里。</p></div>
        </section><p class="vfx-message">{{message}}</p>
      </div>`}
    }); audioDialog.show();
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
          audio() { guard(showAudio); }, help() { showHelp(); }, molang(effect, fixed = false) { return molang(studio, effect, 'main', fixed); }, preview() { guard(() => preview(this.current)); }, copyMolang(fixed = false) { guard(() => copyMolangText(studio, this.current, fixed)); }, capture() { guard(capture); this.$forceUpdate(); },
          syncAssets() { guard(syncExternalAssets); }, exportClient() { guard(exportClient); }, exportFolder() { guard(() => { const dir = pickRecentDirectory('export_folder', '选择导出父目录（将创建包 ID 子目录）'); if (dir) exportTo(dir); }); },
          binding(event) { return eventParticle(this.p, this.current, event); },
          bind(event, value) { this.$set(this.current.eventBindings, event.key, {alias: event.effect, particle: value}); },
          modelChanged() { this.current.modelUnresolved = false; },
          add() { const effect = makeEffect(this.p); this.p.effects.push(effect); this.selected = effect.key; },
          remove() {
            const index = this.p.effects.findIndex(effect => effect.key === this.selected);
            if (index < 0) return;
            const name = this.p.effects[index].name;
            this.p.effects.splice(index, 1);
            this.selected = this.p.effects[index]?.key || this.p.effects[index - 1]?.key || '';
            saveSettings(studio);
            updateRuntimeAfterSave(`已删除特效 ${name}`);
          },
          openParticle(particle) { new Dialog({id: 'vfx_particle_json', title: particle.path, width: 800, form: {json: {type: 'textarea', label: 'Bedrock 粒子 JSON', value: JSON.stringify(particle.json, null, 2)}}, onConfirm(values) { guard(() => { const parsed = JSON.parse(values.json); if (!parsed.particle_effect?.description) throw new Error('缺少 particle_effect.description'); const source = fileAt(studio.root, particle.path); const backup = path.join(path.dirname(studio.root), `${path.basename(studio.root)}-edit-backups`, `${Date.now()}-${token(particle.path)}.json`); fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.copyFileSync(source, backup); fs.writeFileSync(source, JSON.stringify(parsed, null, 2) + '\n'); particle.json = parsed; particle.id = parsed.particle_effect.description.identifier || ''; this.hide(); }); }}).show(); }
        },
        template: `<div class="vfx-studio">
          <p class="vfx-path">{{p.root}}</p>
          <div class="vfx-toolbar"><button @click="help">使用说明</button><button @click="save">保存工程绑定</button><button @click="check">检查引用</button><button @click="syncAssets">同步外部资产到特效包</button><button @click="capture">保存当前编辑回工程</button><button @click="exportFolder">导出到文件夹</button><button @click="exportClient">导出到客户端</button></div>
          <div class="vfx-toolbar"><label>包 ID <input v-model="p.packId"></label><label>显示名 <input v-model="p.displayName"></label></div>
          <p>{{p.models.length}} 模型 · {{p.animations.length}} 动画 · {{p.particles.length}} 粒子 · {{p.textures.length}} 贴图</p>
          <div class="vfx-toolbar"><button @click="tab='effects'">特效绑定</button><button @click="tab='particles'">粒子与贴图</button><button @click="tab='assets'">全部资产</button><button @click="audio">音效</button></div>
          <div v-if="tab==='effects'" class="vfx-columns"><div class="vfx-list"><button @click="add">＋ 新建特效</button><div v-for="e in p.effects" :key="e.key"><input type="checkbox" v-model="e.enabled"><button @click="selected=e.key" :class="{selected:selected===e.key}">{{e.name}}</button></div><p v-if="!p.effects.length">当前工程还没有特效。点击“＋ 新建特效”，再选择模型、动画和粒子。</p></div>
            <div v-if="current" class="vfx-detail">
              <div class="vfx-detail-heading"><label>特效名<input v-model="current.name"></label><button type="button" class="vfx-danger" @click="remove">删除当前特效</button></div><div class="vfx-molang"><label>YSM 指令帧 Molang</label><div class="vfx-molang-row"><code>{{molang(current)}}</code><button type="button" @click="copyMolang(false)">复制跟随播放</button></div><div class="vfx-molang-row"><code>{{molang(current, true)}}</code><button type="button" @click="copyMolang(true)">复制原地播放</button></div><small>原地播放记录指令帧执行时的位置和朝向；放在第 0 帧即可固定于动作起始位置。之后移动/转身不会带走特效；模型动画和粒子自身运动照常播放。</small></div><label>持续时间（tick；20 tick = 1 秒）<input type="number" min="1" max="72000" v-model.number="current.duration"></label>
              <label>模型<select v-model="current.model" @change="modelChanged"><option value="">无模型（仅粒子）</option><option v-for="m in p.models" :value="m.key">{{m.path}} · {{m.id}}</option></select></label>
              <p v-if="current.modelUnresolved">模型关系尚未确认。请选择模型，或点击<button @click="modelChanged">确认为仅粒子</button></p>
              <label v-if="current.model">模型贴图<select v-model="current.texture"><option value="">请选择</option><option v-for="t in p.textures" :value="t.key">{{t.path}}</option></select></label>
              <div v-if="current.model" class="vfx-lighting"><label class="vfx-lighting-toggle"><input type="checkbox" v-model="current.textureColor">贴图原色（实验：无环境光、无分面明暗）</label><label class="vfx-lighting-toggle"><input type="checkbox" v-model="current.ignoreLighting" :disabled="current.textureColor">模型全亮（忽略环境光照）</label><p v-if="current.textureColor">需要配套 eyelib 原色测试版。保留贴图、透明度和动画颜色；在光影主要合成后绘制，不参与辉光、反射或照亮周围。水与玻璃的交叉遮挡存在限制。保存后请在游戏中 reload 测试。</p><p v-else>全亮使用最大光照值，表面仍可能有方向明暗，开启光影后的表现由光影包决定。Blockbench 预览不代表游戏光照。</p></div>
              <label>动画<select v-model="current.animation"><option value="">无动画（静态模型）</option><option v-for="a in p.animations" :value="a.key">{{a.id}} · {{a.path}}</option></select></label>
              <p>逐事件绑定粒子文件；同名事件也可选择不同粒子。导出时自动生成匹配的实体引用。</p>
              <label v-for="event in eventRows" :key="event.key">{{event.time}} s · 事件 {{event.index + 1}} · {{event.effect}} · {{event.locator || '实体原点'}}<select :value="binding(event) || ''" @change="bind(event, $event.target.value)"><option value="">未绑定</option><option v-for="r in p.particles" :value="r.key">{{r.path}}</option></select></label>
              <table><tr><th>触发时间</th><th>事件别名</th><th>定位器</th></tr><tr v-for="r in eventRows"><td>{{r.time}} s</td><td>{{r.effect}}</td><td>{{r.locator || '实体原点'}}</td></tr></table>
              <button @click="preview">打开 / 更新 Blockbench 预览</button><p>空格播放。模型、贴图绘制、动画和定位器在主界面编辑；完成后点击“保存当前编辑回工程”。</p>
            </div></div>
          <div v-if="tab==='particles'"><div v-for="r in p.particles" class="vfx-particle"><strong>{{r.path}}</strong><p>源 ID：{{r.id || '未设置'}}（导出时自动生成独立 ID）</p><label>粒子贴图<select v-model="r.texture"><option value="">未绑定</option><option v-for="t in p.textures" :value="t.key">{{t.path}}</option></select></label><div class="vfx-lighting"><label>粒子光照<select v-model="r.lighting"><option value="source">跟随源 JSON（{{r.json.particle_effect.components &amp;&amp; r.json.particle_effect.components['minecraft:particle_appearance_lighting'] != null ? '接受环境光' : '全亮'}}）</option><option value="ambient">接受环境光照</option><option value="unlit">全亮（忽略环境光照）</option><option value="texture">贴图原色（实验：需配套 eyelib）</option></select></label><p>作用于所有引用此粒子的特效。覆盖设置只写入生成的资源，不改源 JSON。无光影时全亮不受环境光和方向光影响；普通全亮在光影下的表现由光影包决定。原色模式保留粒子 tint 和透明度，在光影主要合成后绘制，不产生辉光。保存工程绑定后在游戏内 reload 测试。</p></div><button @click="openParticle(r)">编辑粒子 JSON</button></div></div>
          <table v-if="tab==='assets'"><tr><th>资产类型</th><th>文件</th></tr><tr v-for="a in p.assets"><td>{{a.type}}</td><td>{{a.path}}</td></tr></table>
          <pre v-if="message" class="vfx-message">{{message}}</pre><details v-if="p.warnings.length"><summary>导入提示（{{p.warnings.length}}）</summary><p v-for="w in p.warnings">{{w}}</p></details>
        </div>`
      }
    });
    dialog.show();
  }
  function importProject() {
    const root = pickRecentDirectory('import_project', '选择 VFX 源工程文件夹或已有特效包');
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
    icon: 'auto_awesome', version: '1.0.0-pre.2-fixed.1', min_version: '5.0.0', variant: 'desktop', tags: ['Animation', 'Minecraft: Java Edition'],
    onload() {
      Blockbench.on('undo', undoSyncListener);
      Blockbench.on('redo', redoSyncListener);
      originalMergeProject = Codecs.project.merge;
      mergeProjectHook = function(model, ...args) {
        const project = Project;
        const target = Format === Formats.bedrock && sessions.has(project?.uuid) ? importedUvSize(model, Outliner.elements.length > 0) : null;
        const result = originalMergeProject.call(this, model, ...args);
        if (target && Project === project && Cube.all.length &&
            (project.texture_width !== target.width || project.texture_height !== target.height)) guard(() => {
          const changes = planImportedUv(Cube.all, {width: project.texture_width, height: project.texture_height}, target);
          Undo.initEdit({elements: Cube.all.filter(c => !c.box_uv), uv_only: true, uv_mode: true, textures: Texture.all});
          project.texture_width = target.width; project.texture_height = target.height;
          for (const texture of Texture.all) { texture.uv_width = target.width; texture.uv_height = target.height; }
          for (const change of changes) change.face.uv = change.uv;
          Canvas.updateAllUVs();
          Undo.finishEdit('继承导入模型的 UV 尺寸');
          Blockbench.showQuickMessage(`已采用原模型 UV 尺寸 ${target.width}×${target.height}，并同步逐面 UV。保存当前编辑回工程后生效。`, 6000);
        });
        return result;
      };
      Codecs.project.merge = mergeProjectHook;
      style = Blockbench.addCSS('.vfx-studio{padding:12px}.vfx-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.vfx-path{word-break:break-all;color:var(--color-subtle_text)}.vfx-columns{display:grid;grid-template-columns:190px 1fr;gap:20px}.vfx-list>div{display:flex;margin:6px 0}.vfx-list button{overflow-wrap:anywhere}.vfx-detail label,.vfx-particle label{display:flex;flex-direction:column;margin-bottom:12px;gap:4px}.vfx-detail-heading{display:flex;align-items:flex-end;gap:12px}.vfx-detail-heading>label{flex:1;min-width:0}.vfx-danger{background:var(--color-close);color:var(--color-light);white-space:nowrap}.vfx-detail select,.vfx-particle select{width:100%}.vfx-studio table{width:100%;margin:12px 0}.vfx-studio td{padding:6px;word-break:break-all}.vfx-particle{padding:12px;border-bottom:1px solid var(--color-border)}.vfx-message{white-space:pre-wrap;padding:12px}.vfx-list .selected{color:var(--color-accent)}' + `
        dialog#vfx_new_pack{width:min(760px,calc(100vw - 32px)) !important}dialog#vfx_new_pack .dialog_content{margin:22px 28px 12px}dialog#vfx_new_pack .dialog_bar.form_bar{display:grid;grid-template-columns:minmax(150px,190px) minmax(0,1fr) 18px !important;align-items:center;column-gap:20px;min-height:38px;margin:10px 0}dialog#vfx_new_pack .dialog_bar.form_bar>label.name_space_left{width:auto;min-width:0;float:none;padding:0;line-height:1.35}dialog#vfx_new_pack .dialog_bar.form_bar>input[type=text]{width:100%;box-sizing:border-box;min-width:0}dialog#vfx_new_pack .dialog_bar.form_bar>input[type=checkbox]{justify-self:start;width:18px;height:18px;margin:0}dialog#vfx_new_pack .dialog_form_description{justify-self:end}
        dialog#vfx_new_pack{width:min(760px,calc(100vw - 32px))}dialog#vfx_new_pack .dialog_content{margin:22px 28px 12px}dialog#vfx_new_pack .dialog_bar.form_bar{display:grid;grid-template-columns:minmax(150px,190px) minmax(0,1fr);align-items:center;column-gap:20px;min-height:38px;margin:10px 0}dialog#vfx_new_pack .dialog_bar.form_bar>label.name_space_left{width:auto;min-width:0;float:none;padding:0;line-height:1.35}dialog#vfx_new_pack .dialog_bar.form_bar>input[type=text]{width:100%;box-sizing:border-box;min-width:0}dialog#vfx_new_pack .dialog_bar.form_bar>input[type=checkbox]{justify-self:start;width:18px;height:18px;margin:0}dialog#vfx_new_pack .dialog_form_description{justify-self:end}
        .vfx-audio{display:flex;flex-direction:column;gap:12px;min-width:0}.vfx-audio-panel{min-width:0;padding:12px;border:1px solid var(--color-border);border-radius:8px;background:color-mix(in srgb,var(--color-back) 72%,transparent)}.vfx-audio-panel-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px;font-size:1.05em}.vfx-audio-panel-heading span{color:var(--color-subtle_text);font-size:.88em}.vfx-audio-list,.vfx-audio-hit-list{min-width:0;max-height:30vh;overflow-y:auto;overflow-x:hidden;padding:2px 8px 2px 2px;border:1px solid color-mix(in srgb,var(--color-border) 72%,transparent);border-radius:6px;background:color-mix(in srgb,var(--color-back) 55%,transparent)}.vfx-audio-hit-list{max-height:26vh;margin-top:10px}.vfx-audio-card{min-width:0;padding:14px;margin:10px 0;border:1px solid var(--color-border);border-radius:6px;background:var(--color-back)}.vfx-audio-card:first-child{margin-top:2px}.vfx-audio-card:last-child{margin-bottom:2px}.vfx-audio label{display:flex;flex-direction:column;gap:6px;margin:8px 0}.vfx-audio input,.vfx-audio select{min-width:0;width:100%}.vfx-audio input[type=checkbox]{width:20px}.vfx-audio-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.vfx-audio code{white-space:pre-wrap;overflow-wrap:anywhere}.vfx-audio-help{margin:8px 2px;line-height:1.45;color:var(--color-subtle_text)}.vfx-audio-empty{margin:12px 4px;color:var(--color-subtle_text)}.vfx-sync p{margin:12px 0;line-height:1.5}.vfx-sync label{display:flex;flex-direction:column;gap:6px;margin:12px 0}.vfx-sync select{width:100%;min-width:0}.vfx-sync-files{max-height:45vh;overflow:auto}.vfx-sync table{table-layout:fixed;border-collapse:collapse}.vfx-sync th,.vfx-sync td{text-align:left;padding:8px;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere}.vfx-sync th:last-child{width:130px}
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
        .vfx-models .vfx-model-uv-error{margin-top:8px;padding:10px;border:1px solid var(--color-close);border-radius:4px;overflow-wrap:anywhere}
        .vfx-lighting{margin:12px 0;padding:12px;border:1px solid var(--color-border);border-radius:6px}.vfx-lighting p{margin:8px 0 0;line-height:1.5;color:var(--color-subtle_text)}.vfx-studio .vfx-lighting-toggle{display:flex;flex-direction:row;align-items:center;gap:8px;margin:0}.vfx-lighting-toggle input[type=checkbox]{width:18px;height:18px;flex:0 0 18px}
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
        .vfx-model-audio-row{display:block;margin:2px 0;overflow-wrap:anywhere}.vfx-model-audio-row small{color:var(--color-subtle_text);margin-left:4px}.vfx-audio-yss-guide{line-height:1.55;padding:10px 12px;border:1px dashed var(--color-border);border-radius:6px;background:color-mix(in srgb,var(--color-back) 55%,transparent)}
      `);
      molangStyle = Blockbench.addCSS('.vfx-molang{padding:10px 12px;margin:8px 0 16px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-back)}.vfx-molang-row{display:flex;align-items:center;gap:8px}.vfx-molang-row code{flex:1;min-width:0;padding:7px 9px;overflow-wrap:anywhere;white-space:pre-wrap;background:var(--color-back)}.vfx-molang-row button{flex:0 0 auto}.vfx-molang small{display:block;margin-top:6px;color:var(--color-subtle_text)}');
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
        ['repair_uv', '检查/修复退化 UV', 'texture', repairProjectUv],
        ['sync_assets', '同步外部资产到特效包', 'drive_file_move', syncExternalAssets],
        ['update_runtime', '更新当前包的运行时资源', 'build', updateCurrentRuntime],
        ['audio', '音效管理', 'volume_up', showAudio],
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
      if (Codecs.project.merge === mergeProjectHook) Codecs.project.merge = originalMergeProject;
      stopAudioPreview(); audioDialog?.delete(); dialog?.delete(); picker?.delete(); menu?.delete(); actions.forEach(action => action.delete()); MenuBar.update(); style?.delete(); molangStyle?.delete(); sessions.clear();
    }
  });
})();
