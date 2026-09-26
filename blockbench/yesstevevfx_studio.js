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
    return Object.entries(animation?.particle_effects || {}).flatMap(([time, value]) =>
      (Array.isArray(value) ? value : [value]).map((event, index) => ({
        time, index, effect: typeof event === 'string' ? event : event.effect,
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
      if (rel === 'vfx-project.json') continue;
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
      const model = uniqueMatch(project.models.filter(m => m.id === geometryId)) || uniqueMatch(project.models);
      const texture = textureMatch(entity?.textures?.default || Object.values(entity?.textures || {})[0], project.textures);
      const effect = {key: `effect_${project.effects.length + 1}`, enabled: true, name, animation: animation?.key || '', model: model?.key || '', texture,
        duration: definition?.duration_ticks || Math.max(20, Math.ceil((animation?.animation?.animation_length || 5) * 20) + 20), bindings: {}};
      for (const event of events(animation?.animation)) {
        const ref = entity?.particle_effects?.[event.effect];
        const particle = uniqueMatch(project.particles.filter(p => ref ? p.id === ref :
          p.id === event.effect || path.posix.basename(p.path).replace(/(?:\.particle)?\.json$/i, '') === event.effect));
        effect.bindings[event.effect] = particle?.key || '';
      }
      project.effects.push(effect);
    }
    if (Array.isArray(manifest?.effects)) {
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
      if (config.version !== 1) throw new Error('不支持的 vfx-project.json 版本');
      project.packId = config.packId; project.displayName = config.displayName;
      project.effects = config.effects;
      for (const particle of project.particles) particle.texture = config.particleTextures?.[particle.key] || particle.texture;
    }
    return project;
  }
  function settings(project) {
    return {version: 1, packId: project.packId, displayName: project.displayName, effects: clone(project.effects),
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
        const model = effect.model ? find(project.models, effect.model, '模型') : null;
        if (model) find(project.textures, effect.texture, '模型贴图');
        const animation = effect.animation ? find(project.animations, effect.animation, '动画') : null;
        const locators = new Set((model?.geometry.bones || []).flatMap(bone => Object.keys(bone.locators || {})));
        for (const event of events(animation?.animation)) {
          const particle = find(project.particles, effect.bindings[event.effect], `事件“${event.effect}”的粒子`);
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
  function build(project) {
    const errors = validate(project);
    if (errors.length) throw new Error(errors.join('\n'));
    const out = new Map();
    const json = (name, content) => out.set(name, Buffer.from(JSON.stringify(content, null, 2) + '\n'));
    const pack = project.packId;
    const textureId = key => `yesstevevfx:textures/${pack}/${token(key)}`;
    const particleId = key => `yesstevevfx:${pack}/${token(key)}`;
    function putTexture(key) {
      const texture = find(project.textures, key, '贴图');
      out.set(`assets/eyelib/textures/${pack}/${token(key)}.png`, fs.readFileSync(fileAt(project.root, texture.path)));
      return textureId(key);
    }
    const effectPaths = [];
    for (const effect of project.effects.filter(e => e.enabled)) {
      const base = `${pack}.${effect.name}`;
      const geometry = effect.model ? clone(find(project.models, effect.model, '模型').geometry) : emptyGeometry();
      geometry.description.identifier = `geometry.yesstevevfx.${base}`;
      json(`assets/eyelib/models/${pack}/${effect.name}.geo.json`, {format_version: '1.12.0', 'minecraft:geometry': [geometry]});
      const entity = {identifier: `yesstevevfx:${pack}/${effect.name}`, materials: {default: 'entity_alphatest'},
        geometry: {default: geometry.description.identifier}, textures: {}, particle_effects: {},
        render_controllers: [`controller.render.yesstevevfx.${base}`]};
      if (effect.model) entity.textures.default = putTexture(effect.texture);
      else {
        const key = `textures/${pack}/empty`;
        entity.textures.default = `yesstevevfx:${key}`;
        out.set(`assets/eyelib/${key}.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
      }
      if (effect.animation) {
        const animation = clone(find(project.animations, effect.animation, '动画').animation);
        for (const event of events(animation)) {
          const particle = find(project.particles, effect.bindings[event.effect], '粒子');
          entity.particle_effects[event.effect] = particleId(particle.key);
          const doc = clone(particle.json);
          doc.particle_effect.description.identifier = particleId(particle.key);
          doc.particle_effect.description.basic_render_parameters.texture = putTexture(particle.texture);
          json(`assets/eyelib/particles/${pack}/${token(particle.key)}.json`, doc);
        }
        const id = `animation.yesstevevfx.${base}`;
        entity.animations = {main: id}; entity.scripts = {animate: ['main']};
        json(`assets/eyelib/animations/${pack}/${effect.name}.animation.json`, {format_version: '1.8.0', animations: {[id]: animation}});
      }
      const entityPath = `assets/eyelib/entity/${pack}/${effect.name}.json`;
      json(entityPath, {'minecraft:client_entity': {description: entity}});
      json(`assets/eyelib/render_controllers/${pack}/${effect.name}.json`, {render_controllers: {
        [entity.render_controllers[0]]: {geometry: 'Geometry.default', materials: ['Material.default'], textures: ['Texture.default']}
      }});
      const effectPath = `effects/${effect.name}.json`;
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
  const Core = {scan, settings, validate, build, exportPack, saveSettings, createEmptyPack, events, fileAt, token, emptyGeometry};
  if (typeof Blockbench === 'undefined') { module.exports = Core; return; }

  // Desktop UI is below; the import/export core is also exercised by Node tests.
  let studio = null, dialog = null, style = null, menu = null;
  const actions = [];
  const sessions = new Map();
  const errorBox = error => { console.error('[YesSteveVFX]', error); Blockbench.showMessageBox({title: 'YesSteveVFX', message: String(error.message || error)}); };
  function guard(action) { try { return action(); } catch (error) { errorBox(error); } }
  function saveWorkspace() {
    if (!studio) throw new Error('请先导入文件夹');
    saveSettings(studio);
    Blockbench.showQuickMessage('VFX 工程绑定已保存');
  }
  function loadParticlePreview(particle) {
    const absolute = fileAt(studio.root, particle.path);
    // Blockbench indexes emitters by file path, while the Bedrock identifier
    // is what appears in an animation particle frame.  Give every preview
    // emitter a stable, unique identifier so duplicate source identifiers do
    // not overwrite each other in the particle picker.
    const document = clone(particle.json);
    document.particle_effect.description.identifier = previewIdentifier(particle.path);
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
        '2. 在“特效绑定”中逐个选择 effect。动画文件里的全部动画会自动列出；取消左侧勾选即可不导出。',
        '3. 为每个 effect 选择模型、模型贴图和动画。数字粒子事件（例如 12、2、3）必须在事件绑定下拉框中手动指定对应粒子。',
        '4. 点击“检查引用”，确认没有未绑定的粒子、贴图或定位器。点击“打开 / 更新 Blockbench 预览”后，在动画模式按空格播放。',
        '动画列表显示源 animation.json 文件名；动画行/文件分组的保存按钮直接写回该文件。原生保存不生成 VFX 备份，导出前请保存修改。',
        '5. 在 Blockbench 中编辑骨骼、定位器、贴图或动画；完成后点击 VFX → 保存当前编辑回工程。原文件会先备份到工程同级的 *-edit-backups。',
        '6. 点击“导出到客户端”，选择 .minecraft；检测到 versions 时再选择具体隔离版本。进入游戏后执行 /vfx_client reload，再用 /vfx_client play <pack_id>:<effect> test 播放。',
        '',
        '**常用菜单**',
        'VFX → 导入工程文件夹：开始或切换工程。',
        'VFX → 资产与绑定：重新打开当前工程。',
        'VFX → 保存当前编辑回工程：写回当前预览标签的模型和动画。',
        'VFX → 导出到客户端：写入 config/yesstevevfx/packs，并把旧包移到 vfx-backups。',
        '',
        '预览和游戏渲染是两条独立链路：预览缺失优先检查绑定或粒子 JSON；预览正常而游戏缺失再检查导出包和运行时日志。'
      ].join('\n')
    });
  }
  function bindPreview(animation, effect) {
    for (const keyframe of animation.animators.effects?.particle || []) {
      for (const point of keyframe.data_points) {
        const particle = studio.particles.find(p => p.key === effect.bindings[point.effect]);
        if (!particle) continue;
        const absolute = fileAt(studio.root, particle.path);
        // The complete particle library is loaded before animation binding;
        // reuse that entry so newly added timeline frames see the same file.
        loadParticlePreview(particle);
        point.file = absolute;
      }
    }
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
    const existing = [...sessions.entries()].find(([, s]) => s.studio === studio && s.effect === effect && s.project);
    if (existing) {
      existing[1].project.select();
      if (existing[1].model !== effect.model || existing[1].texture !== effect.texture) throw new Error('模型/贴图绑定已改变。请先保存并关闭旧预览标签，再重新打开。');
      for (const animation of Animation.all) {
        const animationEffect = existing[1].animationEffects.get(animation.uuid) || effect;
        bindPreview(animation, animationEffect);
      }
      dialog?.hide(); showAnimationPanel(); Animator.preview(); return;
    }
    const model = effect.model ? find(studio.models, effect.model, '模型') : null;
    if (model) {
      const absolute = fileAt(studio.root, model.path);
      const document = readJson(absolute);
      const geometry = document['minecraft:geometry']?.[model.index];
      if (!geometry) throw new Error(`源文件中找不到模型：${model.path} #${model.index}`);
      model.geometry = clone(geometry);
      model.id = geometry.description?.identifier || '';
      // Use the same file-opening entry point as YSM. The native codec sets
      // export_path/export_codec, so Ctrl+S writes back to the original JSON.
      // Select this effect's geometry upfront; native Bedrock overwrite merges
      // it by identifier and preserves the other geometries in the source file.
      loadModelFile({name: path.basename(absolute), path: absolute,
        content: JSON.stringify({...document, 'minecraft:geometry': [geometry]})});
    } else {
      // Particle-only previews have no source model to save over.
      setupProject(Formats.bedrock);
      Codecs.bedrock.load({format_version: '1.12.0', 'minecraft:geometry': [emptyGeometry()]},
        {path: '', no_file: true}, {import_to_current_project: true});
      Project.name = `VFX · ${effect.name}`;
    }
    const project = Project;
    const textureAsset = effect.model ? find(studio.textures, effect.texture, '模型贴图') : null;
    const texture = textureAsset ? new Texture({keep_size: true}).fromPath(fileAt(studio.root, textureAsset.path)).add() : null;
    if (texture) { texture.select(); Cube.all.forEach(cube => cube.applyTexture(texture, true)); }
    const session = {studio, effect, project, model: effect.model, texture: effect.texture, textureObject: texture,
      animationObjects: new Map(), animationEffects: new Map()};
    sessions.set(project.uuid, session);
    if (effect.animation) {
      const source = find(studio.animations, effect.animation, '动画');
      // Import the complete animation file.  The selected effect is only the
      // initial animation; all siblings remain visible in Blockbench's
      // animation panel so the author can switch between test1..test5.
      const fileAnimations = studio.animations.filter(animation => animation.path === source.path);
      const animations = Object.fromEntries(fileAnimations.map(animation => [animation.id, clone(animation.animation)]));
      const file = {name: path.basename(source.path), path: fileAt(studio.root, source.path), json: {format_version: '1.8.0', animations}};
      file.content = JSON.stringify(file.json);
      const loaded = typeof AnimationCodec !== 'undefined'
        ? AnimationCodec.codecs.bedrock.loadFile(file) : Animator.loadFile(file);
      for (const animation of loaded) {
        const sourceAnimation = fileAnimations.find(candidate => candidate.id === animation.name);
        const animationEffect = studio.effects.find(candidate => candidate.animation === sourceAnimation?.key) || effect;
        session.animationObjects.set(animation.uuid, sourceAnimation?.key || source.key);
        session.animationEffects.set(animation.uuid, animationEffect);
        bindPreview(animation, animationEffect);
      }
      (loaded.find(animation => session.animationObjects.get(animation.uuid) === source.key) || loaded[0])?.select();
      session.animationFile = source.path;
    }
    const particleCount = loadParticleLibrary();
    dialog?.hide(); showAnimationPanel(); Timeline.setTime(0); Animator.preview();
    if (errors.length) {
      Blockbench.showQuickMessage(`已打开预览并注册 ${particleCount} 个粒子；仍有 ${errors.length} 个引用待绑定，可在资产窗口中检查。`, 6000);
    } else {
      Blockbench.showQuickMessage(`已打开模型预览，载入 ${Animation.all.length} 个动画并注册 ${particleCount} 个粒子。可在动画列表中切换预览。`, 6000);
    }
  }
  function capture() {
    const session = sessions.get(Project?.uuid);
    if (!session || session.studio !== studio) throw new Error('当前标签不是此 VFX 工程的预览标签');
    const writes = new Map();
    if (session.model) {
      const model = find(studio.models, session.model, '模型');
      const compiled = Codecs.bedrock.compile({raw: true});
      const geometry = clone(compiled['minecraft:geometry'][0]);
      geometry.description.identifier = model.id;
      const document = readJson(fileAt(studio.root, model.path));
      document['minecraft:geometry'][model.index] = geometry;
      writes.set(model.path, Buffer.from(JSON.stringify(document, null, 2) + '\n'));
    }
    const pendingAnimations = [];
    for (const animation of Animation.all) {
      const animationEffect = session.animationEffects.get(animation.uuid) || session.effect;
      let key = session.animationObjects.get(animation.uuid);
      let source = studio.animations.find(a => a.key === key);
      if (!source) {
        const rel = `animations/${token(animation.name)}.animation.json`;
        key = `${rel}#${animation.name}`;
        source = {key, path: rel, id: animation.name};
      }
      // Only explicitly selected files can seed a new alias binding.
      for (const frame of animation.animators.effects?.particle || []) for (const point of frame.data_points) {
        if (point.file) {
          const particle = studio.particles.find(p => path.resolve(fileAt(studio.root, p.path)) === path.resolve(point.file));
          if (particle) {
            const alias = particleAlias(animationEffect, particle);
            if (alias) {
              animationEffect.bindings[alias] = particle.key;
              // Blockbench may put the preview emitter identifier into the
              // Bedrock event. Store the stable source alias instead.
              point.effect = alias;
            }
          }
        }
      }
      const compiled = typeof AnimationCodec !== 'undefined' ? AnimationCodec.codecs.bedrock.compileAnimation(animation) : animation.compileBedrockAnimation();
      normalizeParticleAliases(compiled, animationEffect);
      let doc = writes.has(source.path) ? JSON.parse(writes.get(source.path).toString()) :
        (fs.existsSync(fileAt(studio.root, source.path)) ? readJson(fileAt(studio.root, source.path)) : {format_version: '1.8.0', animations: {}});
      if (source.id !== animation.name) delete doc.animations[source.id];
      doc.animations[animation.name] = compiled;
      writes.set(source.path, Buffer.from(JSON.stringify(doc, null, 2) + '\n'));
      pendingAnimations.push({source, animation, compiled});
    }
    if (session.textureObject && session.textureObject.saved === false) {
      writes.set(session.texture, Buffer.from(session.textureObject.getBase64(), 'base64'));
    }
    const backup = path.join(path.dirname(studio.root), `${path.basename(studio.root)}-edit-backups`, String(Date.now()));
    for (const [rel, bytes] of writes) {
      const dest = fileAt(studio.root, rel);
      if (fs.existsSync(dest)) { const old = fileAt(backup, rel); fs.mkdirSync(path.dirname(old), {recursive: true}); fs.copyFileSync(dest, old); }
      fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.writeFileSync(dest, bytes);
    }
    if (session.model) {
      const model = find(studio.models, session.model, '模型');
      model.geometry = readJson(fileAt(studio.root, model.path))['minecraft:geometry'][model.index];
    }
    for (const {source, animation, compiled} of pendingAnimations) {
      source.animation = clone(compiled);
      // Stable source keys keep existing effect bindings intact when renamed in BB.
      source.id = animation.name;
      if (!studio.animations.includes(source)) studio.animations.push(source);
      session.animationObjects.set(animation.uuid, source.key);
      animation.path = fileAt(studio.root, source.path);
      animation.saved_name = animation.name;
      animation.saved = true;
    }
    saveSettings(studio);
    Blockbench.showQuickMessage(`已保存 ${writes.size} 个编辑资产（备份位于工程同级目录）`, 5000);
  }
  function particleAlias(effect, particle) {
    const existing = Object.entries(effect?.bindings || {}).find(([, key]) => key === particle.key)?.[0];
    if (existing && !existing.startsWith('yesstevevfx:preview/')) return existing;
    const id = String(particle.id || '').trim();
    if (id) return id;
    return path.posix.basename(particle.path).replace(/(?:\.particle)?\.json$/i, '') || token(particle.path);
  }
  function normalizeParticleAliases(animation, effect) {
    if (!animation?.particle_effects || !effect) return;
    for (const values of Object.values(animation.particle_effects)) {
      const list = Array.isArray(values) ? values : [values];
      for (const event of list) {
        if (!event || typeof event !== 'object') continue;
        const preview = studio.particles.find(p => previewIdentifier(p.path) === event.effect);
        if (!preview) continue;
        const alias = particleAlias(effect, preview);
        if (alias) {
          event.effect = alias;
          effect.bindings[alias] = preview.key;
        }
      }
    }
  }
  function refreshSavedAnimations() {
    // Native Ctrl+S also writes the linked geometry file. Export must read
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
      for (const effect of studio.effects.filter(candidate => candidate.animation === source.key)) {
        normalizeParticleAliases(source.animation, effect);
      }
    }
  }
  function exportTo(parent) {
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
          aliases() { return [...new Set(this.eventRows.map(e => e.effect))]; }
        },
        methods: {
          save() { guard(saveWorkspace); }, check() { this.message = validate(studio).join('\n') || '检查通过：每个动画事件、定位器和贴图都有明确绑定。'; },
          help() { showHelp(); }, preview() { guard(() => preview(this.current)); }, capture() { guard(capture); this.$forceUpdate(); },
          exportClient() { guard(exportClient); }, exportFolder() { guard(() => { const dir = Blockbench.pickDirectory({title: '选择导出父目录（将创建包 ID 子目录）'}); if (dir) exportTo(dir); }); },
          bind(alias, value) { this.$set(this.current.bindings, alias, value); },
          add() { const effect = {key: `effect_${Date.now()}`, name: `effect_${this.p.effects.length + 1}`, enabled: true, model: '', texture: '', animation: '', duration: 120, bindings: {}}; this.p.effects.push(effect); this.selected = effect.key; },
          openParticle(particle) { new Dialog({id: 'vfx_particle_json', title: particle.path, width: 800, form: {json: {type: 'textarea', label: 'Bedrock 粒子 JSON', value: JSON.stringify(particle.json, null, 2)}}, onConfirm(values) { guard(() => { const parsed = JSON.parse(values.json); if (!parsed.particle_effect?.description) throw new Error('缺少 particle_effect.description'); const source = fileAt(studio.root, particle.path); const backup = path.join(path.dirname(studio.root), `${path.basename(studio.root)}-edit-backups`, `${Date.now()}-${token(particle.path)}.json`); fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.copyFileSync(source, backup); fs.writeFileSync(source, JSON.stringify(parsed, null, 2) + '\n'); particle.json = parsed; this.hide(); }); }}).show(); }
        },
        template: `<div class="vfx-studio">
          <p class="vfx-path">{{p.root}}</p>
          <div class="vfx-toolbar"><button @click="help">使用说明</button><button @click="save">保存工程绑定</button><button @click="check">检查引用</button><button @click="capture">保存当前编辑回工程</button><button @click="exportFolder">导出到文件夹</button><button @click="exportClient">导出到客户端</button></div>
          <div class="vfx-toolbar"><label>包 ID <input v-model="p.packId"></label><label>显示名 <input v-model="p.displayName"></label></div>
          <p>{{p.models.length}} 模型 · {{p.animations.length}} 动画 · {{p.particles.length}} 粒子 · {{p.textures.length}} 贴图</p>
          <div class="vfx-toolbar"><button @click="tab='effects'">特效绑定</button><button @click="tab='particles'">粒子与贴图</button><button @click="tab='assets'">全部资产</button></div>
          <div v-if="tab==='effects'" class="vfx-columns"><div class="vfx-list"><button @click="add">＋ 新建特效</button><div v-for="e in p.effects" :key="e.key"><input type="checkbox" v-model="e.enabled"><button @click="selected=e.key" :class="{selected:selected===e.key}">{{e.name}}</button></div><p v-if="!p.effects.length">当前工程还没有特效。点击“＋ 新建特效”，再选择模型、动画和粒子。</p></div>
            <div v-if="current" class="vfx-detail">
              <label>特效名<input v-model="current.name"></label><label>持续时间（tick；20 tick = 1 秒）<input type="number" min="1" max="72000" v-model.number="current.duration"></label>
              <label>模型<select v-model="current.model"><option value="">无模型（仅粒子）</option v-for="m in p.models" :value="m.key">{{m.path}} · {{m.id}}</option></select></label>
              <label v-if="current.model">模型贴图<select v-model="current.texture"><option value="">请选择</option><option v-for="t in p.textures" :value="t.key">{{t.path}}</option></select></label>
              <label>动画<select v-model="current.animation"><option value="">无动画（静态模型）</option><option v-for="a in p.animations" :value="a.key">{{a.id}} · {{a.path}}</option></select></label>
              <p>动画事件别名 → 粒子文件（数字别名可保留；必须明确选择）</p>
              <label v-for="alias in aliases" :key="alias">{{alias}}<select :value="current.bindings[alias] || ''" @change="bind(alias, $event.target.value)"><option value="">未绑定</option><option v-for="r in p.particles" :value="r.key">{{r.path}}</option></select></label>
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
    showStudio();
    const firstEffect = studio.effects.find(effect => effect.enabled) || studio.effects[0];
    if (firstEffect) {
      // Match YSM's import flow: open the model project immediately, then
      // load the selected animation and the complete particle library.
      guard(() => preview(firstEffect, {allowIncomplete: true}));
    } else {
      Blockbench.showQuickMessage(`导入完成：${studio.assets.length} 个文件，但没有可预览的 effect`, 5000);
    }
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
    icon: 'auto_awesome', version: '0.1.0', min_version: '5.0.0', variant: 'desktop', tags: ['Animation', 'Minecraft: Java Edition'],
    onload() {
      style = Blockbench.addCSS('.vfx-studio{padding:12px}.vfx-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.vfx-path{word-break:break-all;color:var(--color-subtle_text)}.vfx-columns{display:grid;grid-template-columns:190px 1fr;gap:20px}.vfx-list>div{display:flex;margin:6px 0}.vfx-list button{overflow-wrap:anywhere}.vfx-detail label,.vfx-particle label{display:flex;flex-direction:column;margin-bottom:12px;gap:4px}.vfx-detail select,.vfx-particle select{width:100%}.vfx-studio table{width:100%;margin:12px 0}.vfx-studio td{padding:6px;word-break:break-all}.vfx-particle{padding:12px;border-bottom:1px solid var(--color-border)}.vfx-message{white-space:pre-wrap;padding:12px}.vfx-list .selected{color:var(--color-accent)}');
      for (const [id, name, fn] of [['import', '导入工程文件夹', importProject], ['new_pack', '新建特效包', createPack], ['manage', '资产与绑定', showStudio], ['help', '使用说明', showHelp], ['capture', '保存当前编辑回工程', capture], ['export', '导出到客户端', exportClient]]) {
        const action = new Action(`yesstevevfx_${id}`, {name, icon: 'auto_awesome', click: () => guard(fn)});
        actions.push(action);
      }
      menu = new BarMenu('yesstevevfx', actions, {name: 'VFX'});
      MenuBar.update();
    },
    onunload() { dialog?.hide(); menu?.delete(); actions.forEach(action => action.delete()); MenuBar.update(); style?.delete(); sessions.clear(); }
  });
})();
