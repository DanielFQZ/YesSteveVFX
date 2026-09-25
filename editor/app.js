const state = {
  root: null,
  targetRoot: null,
  targetLabel: '',
  versions: new Map(),
  files: new Map(),
  animations: []
};
const $ = (id) => document.getElementById(id);

function writeLog(message, error = false) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  const log = $('log');
  log.textContent = `${log.textContent === '等待操作…' ? '' : `${log.textContent}\n`}${line}`;
  log.style.color = error ? 'var(--danger)' : '';
}

function setStatus(message, kind = 'info') {
  const status = $('operationStatus');
  status.textContent = message;
  status.className = `status ${kind}`;
}

function safeId(value, fallback) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '');
  return normalized || fallback;
}

function updatePreview() {
  const pack = safeId($('packId').value, 'my_effects');
  const selected = state.animations.filter((animation) => animation.enabled);
  const names = selected.length
    ? selected.slice(0, 2).map((animation) => safeId(animation.effectName, 'effect'))
    : [safeId($('effectName').value, 'demo')];
  const suffix = selected.length > 2 ? `（以及另外 ${selected.length - 2} 个）` : '';
  $('effectIdPreview').textContent = `${pack}:${names.join(', ')}${suffix}`;
}

function renderFiles() {
  const paths = [...state.files.keys()].sort();
  $('fileSummary').textContent = paths.length ? `已导入 ${paths.length} 个文件` : '还没有导入资源';
  $('fileList').replaceChildren(...paths.map((path) => {
    const item = document.createElement('li');
    item.textContent = path;
    return item;
  }));
  $('savePack').disabled = !paths.length || !state.targetRoot;
}

function renderAnimations() {
  const list = $('animationList');
  list.replaceChildren();
  if (!state.animations.length) {
    $('animationSummary').textContent = '没有识别到动画；保存时会使用“无动画时的特效名”生成一个 effect。';
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '导入 .animation.json 后，这里会列出其中的全部动画。';
    list.append(empty);
    updatePreview();
    return;
  }

  const enabledCount = state.animations.filter((animation) => animation.enabled).length;
  $('animationSummary').textContent = `识别到 ${state.animations.length} 个动画，当前选中 ${enabledCount} 个。每个选中的动画会生成一个独立 effect。`;
  for (const animation of state.animations) {
    const row = document.createElement('div');
    row.className = 'animation-row';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = animation.enabled;
    toggle.title = '是否为这个动画生成 effect';
    toggle.addEventListener('change', () => {
      animation.enabled = toggle.checked;
      renderAnimations();
      renderFiles();
    });

    const original = document.createElement('code');
    original.className = 'animation-id';
    original.textContent = animation.id;
    original.title = animation.sourcePath;

    const nameLabel = document.createElement('label');
    nameLabel.className = 'animation-name';
    nameLabel.textContent = 'Effect 名称';
    const nameInput = document.createElement('input');
    nameInput.value = animation.effectName;
    nameInput.maxLength = 48;
    nameInput.spellcheck = false;
    nameInput.addEventListener('input', () => {
      animation.effectName = nameInput.value;
      updatePreview();
    });
    nameLabel.append(nameInput);

    const source = document.createElement('span');
    source.className = 'animation-source';
    source.textContent = animation.sourcePath;

    row.append(toggle, original, nameLabel, source);
    list.append(row);
  }
  updatePreview();
}

function normalizeSlash(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function normalizedImportedPath(path) {
  let clean = normalizeSlash(path);
  const manifestIndex = clean.lastIndexOf('manifest.json');
  if (manifestIndex >= 0 && (manifestIndex === 0 || clean[manifestIndex - 1] === '/')) return 'manifest.json';
  const assetIndex = clean.indexOf('assets/');
  if (assetIndex >= 0) return clean.slice(assetIndex);
  const effectIndex = clean.indexOf('effects/');
  if (effectIndex >= 0) return clean.slice(effectIndex);

  const name = clean.split('/').pop();
  const lower = clean.toLowerCase();
  if (lower.endsWith('.geo.json')) return `assets/eyelib/models/${name}`;
  if (lower.endsWith('.animation.json') || lower.endsWith('/animation.json') || lower.includes('/animations/')) return `assets/eyelib/animations/${name}`;
  if (lower.includes('render_controller') || lower.includes('/render_controllers/')) return `assets/eyelib/render_controllers/${name}`;
  if (lower.includes('particle') || lower.includes('/particles/')) return `assets/eyelib/particles/${name}`;
  if (lower.includes('entity') || lower.includes('client_entity')) return `assets/eyelib/entity/${name}`;
  if (/\.(png|jpe?g)$/i.test(name)) return `assets/eyelib/textures/${name}`;
  return `assets/eyelib/misc/${name}`;
}

async function addFiles(files) {
  if (!files.length) throw new Error('没有读取到可导入的文件');
  for (const item of files) {
    const file = item.file || item;
    const sourcePath = item.path || file.webkitRelativePath || file.name;
    const path = normalizedImportedPath(sourcePath);
    state.files.set(path, file);
  }
  await scanAnimations();
  renderFiles();
  const message = `导入完成：${state.files.size} 个文件，识别到 ${state.animations.length} 个动画`;
  setStatus(message, 'success');
  writeLog(message);
}

function readEntry(entry, path = '') {
  return new Promise((resolve, reject) => entry.file(
    (file) => resolve({ file, path: `${path}${file.name}` }),
    reject
  ));
}

async function readDirectory(entry, prefix = '') {
  const reader = entry.createReader();
  const result = [];
  while (true) {
    const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) break;
    for (const child of entries) {
      if (child.isFile) result.push(await readEntry(child, prefix));
      else if (child.isDirectory) result.push(...await readDirectory(child, `${prefix}${child.name}/`));
    }
  }
  return result;
}

async function importDrop(dataTransfer) {
  const files = [];
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  for (const entry of entries) {
    if (entry.isFile) files.push(await readEntry(entry));
    else if (entry.isDirectory) files.push(...await readDirectory(entry, `${entry.name}/`));
  }
  if (!files.length) {
    await addFiles([...dataTransfer.files]);
  } else {
    await addFiles(files);
  }
}

function parseJson(file, label) {
  return file.text().then((text) => {
    try { return JSON.parse(text); }
    catch (error) { writeLog(`${label} JSON 解析失败：${error.message}`, true); return null; }
  });
}

function firstPath(paths, predicate) { return paths.find((path) => predicate(path.toLowerCase())); }
function withoutExtension(path) { return path.replace(/\.(png|jpe?g)$/i, ''); }

function defaultAnimationName(id) {
  const tail = id.split('.').pop() || id;
  return safeId(tail, 'effect');
}

/*
 * eyelib keeps Bedrock resources in shared registries.  Imported Blockbench
 * files often use the editor defaults (for example geometry.unknown) or omit
 * particle identifiers altogether; those values are not valid for the
 * yesstevevfx-owned registries.  Normalize the resource documents while the
 * pack is being built so every generated entity points at the same IDs that
 * will be published.
 */
function normalizeGeometryIdentifier(id, fallback = 'model') {
  if (typeof id === 'string' && id.startsWith('geometry.yesstevevfx.')) return id;
  const raw = typeof id === 'string' ? id.replace(/^geometry\./, '') : '';
  return `geometry.yesstevevfx.${safeId(raw, fallback)}`;
}

function normalizeAnimationIdentifier(id, fallback = 'animation') {
  if (typeof id === 'string' && id.startsWith('animation.yesstevevfx.')) return id;
  const raw = typeof id === 'string' ? id.replace(/^animation\./, '') : '';
  return `animation.yesstevevfx.${safeId(raw, fallback)}`;
}

function normalizeRenderControllerIdentifier(id, fallback = 'effect') {
  if (typeof id === 'string' && id.startsWith('controller.render.yesstevevfx.')) return id;
  const raw = typeof id === 'string' ? id.replace(/^controller\.render\./, '') : '';
  return `controller.render.yesstevevfx.${safeId(raw, fallback)}`;
}

function normalizeParticleIdentifier(id, shortName) {
  if (typeof id === 'string' && id.startsWith('yesstevevfx:')) return id;
  return `yesstevevfx:imported/${safeId(shortName, 'particle')}`;
}

async function normalizeImportedResources(files) {
  for (const path of [...files.keys()]) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.json')) continue;
    const json = await parseJson(files.get(path), path);
    if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
    let changed = false;

    if (lower.includes('/models/') && Array.isArray(json['minecraft:geometry'])) {
      json['minecraft:geometry'].forEach((entry, index) => {
        const description = entry?.description;
        if (!description || typeof description !== 'object') return;
        const next = normalizeGeometryIdentifier(description.identifier, `${safeId(path, 'model')}_${index + 1}`);
        if (description.identifier !== next) {
          description.identifier = next;
          changed = true;
        }
      });
    } else if (lower.includes('/animations/')) {
      const animations = json.animations;
      if (animations && typeof animations === 'object' && !Array.isArray(animations)) {
        const normalized = {};
        for (const [id, animation] of Object.entries(animations)) {
          const next = normalizeAnimationIdentifier(id, safeId(path, 'animation'));
          normalized[next] = animation;
          changed ||= next !== id;
        }
        json.animations = normalized;
      }
    } else if (lower.includes('/render_controllers/')) {
      const controllers = json.render_controllers;
      if (controllers && typeof controllers === 'object' && !Array.isArray(controllers)) {
        const normalized = {};
        for (const [id, controller] of Object.entries(controllers)) {
          const next = normalizeRenderControllerIdentifier(id, safeId(path, 'effect'));
          normalized[next] = controller;
          changed ||= next !== id;
        }
        json.render_controllers = normalized;
      }
    } else if (lower.includes('/particles/')) {
      const description = json.particle_effect?.description;
      if (description && typeof description === 'object') {
        const short = path.split('/').pop().replace(/\.json$/i, '');
        const next = normalizeParticleIdentifier(description.identifier, short);
        if (description.identifier !== next) {
          description.identifier = next;
          changed = true;
        }
      }
    } else if (lower.includes('/entity/')) {
      const description = json['minecraft:client_entity']?.description;
      if (description && typeof description === 'object') {
        if (typeof description.identifier === 'string' && !description.identifier.startsWith('yesstevevfx:')) {
          description.identifier = `yesstevevfx:${safeId(description.identifier.split(':').pop(), safeId(path, 'effect'))}`;
          changed = true;
        }
        if (description.geometry && typeof description.geometry === 'object') {
          for (const [key, value] of Object.entries(description.geometry)) {
            const next = normalizeGeometryIdentifier(value, safeId(path, 'model'));
            if (value !== next) {
              description.geometry[key] = next;
              changed = true;
            }
          }
        }
        if (description.animations && typeof description.animations === 'object') {
          for (const [key, value] of Object.entries(description.animations)) {
            const next = normalizeAnimationIdentifier(value, safeId(path, 'animation'));
            if (value !== next) {
              description.animations[key] = next;
              changed = true;
            }
          }
        }
        if (Array.isArray(description.render_controllers)) {
          description.render_controllers = description.render_controllers.map((value) => {
            const next = normalizeRenderControllerIdentifier(value, safeId(path, 'effect'));
            if (value !== next) changed = true;
            return next;
          });
        }
        if (description.particle_effects && typeof description.particle_effects === 'object') {
          for (const [key, value] of Object.entries(description.particle_effects)) {
            const next = normalizeParticleIdentifier(value, key);
            if (value !== next) {
              description.particle_effects[key] = next;
              changed = true;
            }
          }
        }
      }
    }

    if (changed) {
      files.set(path, new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    }
  }
}

function uniqueName(name, used) {
  const base = safeId(name, 'effect');
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

async function scanAnimations() {
  const found = [];
  const used = new Set();
  const paths = [...state.files.keys()]
    .filter((path) => {
      const lower = path.toLowerCase();
      return lower.endsWith('.animation.json') || lower.endsWith('/animation.json') || lower.includes('/animations/');
    })
    .sort();
  for (const path of paths) {
    const json = await parseJson(state.files.get(path), path);
    const animations = json?.animations;
    if (!animations || typeof animations !== 'object' || Array.isArray(animations)) continue;
    for (const id of Object.keys(animations)) {
      found.push({ sourcePath: path, id, effectName: uniqueName(defaultAnimationName(id), used), enabled: true });
    }
  }
  state.animations = found;
  renderAnimations();
}

function geometryIdentifier(json, fallback) {
  const entries = json?.['minecraft:geometry'];
  return normalizeGeometryIdentifier(entries?.[0]?.description?.identifier, fallback);
}

function renderControllerIdentifier(json, fallback) {
  const controllers = json?.render_controllers;
  return normalizeRenderControllerIdentifier(controllers && Object.keys(controllers)[0], fallback);
}

async function generatedEntity(files, effectName, animationId) {
  const paths = [...files.keys()];
  const modelPath = firstPath(paths, (p) => p.endsWith('.geo.json'));
  const renderPath = firstPath(paths, (p) => p.includes('/render_controllers/'));
  const texturePath = firstPath(paths, (p) => p.includes('/textures/') && /\.(png|jpe?g)$/.test(p));
  const particlePaths = paths.filter((p) => p.includes('/particles/') && p.endsWith('.json'));
  const modelJson = modelPath ? await parseJson(files.get(modelPath), modelPath) : null;
  const renderJson = renderPath ? await parseJson(files.get(renderPath), renderPath) : null;
  const geometry = geometryIdentifier(modelJson, `geometry.yesstevevfx.${effectName}`);
  const renderController = renderControllerIdentifier(renderJson, `controller.render.yesstevevfx.${effectName}`);
  const texture = texturePath ? `yesstevevfx:textures/${withoutExtension(texturePath.split('/textures/')[1])}` : `yesstevevfx:textures/${effectName}`;
  const particles = {};
  for (const path of particlePaths) {
    const short = path.split('/').pop().replace(/\.json$/i, '');
    const json = await parseJson(files.get(path), path);
    const id = json?.particle_effect?.description?.identifier || json?.['particle_effect']?.description?.identifier;
    particles[short] = normalizeParticleIdentifier(id, short);
  }
  const description = {
    identifier: `yesstevevfx:${effectName}`,
    materials: { default: 'entity_alphatest' },
    textures: { default: texture },
    geometry: { default: geometry },
    particle_effects: particles,
    render_controllers: [renderController]
  };
  if (animationId) {
    description.animations = { main: normalizeAnimationIdentifier(animationId, effectName) };
    description.scripts = { animate: ['main'] };
  }
  const entity = { 'minecraft:client_entity': { description } };
  const output = new Map(files);
  output.set(`assets/eyelib/entity/${effectName}.json`, new Blob([JSON.stringify(entity, null, 2)], { type: 'application/json' }));
  if (!renderPath) {
    const controller = { render_controllers: { [renderController]: { geometry: 'Geometry.default', materials: ['Material.default'], textures: ['Texture.default'] } } };
    output.set(`assets/eyelib/render_controllers/${effectName}.json`, new Blob([JSON.stringify(controller, null, 2)], { type: 'application/json' }));
  }
  return { output, entityPath: `assets/eyelib/entity/${effectName}.json` };
}

function selectedEffects() {
  const selected = state.animations.filter((animation) => animation.enabled);
  if (!selected.length) {
    return [{ effectName: safeId($('effectName').value, 'demo'), animationId: null }];
  }
  const used = new Set();
  return selected.map((animation, index) => {
    const effectName = safeId(animation.effectName, `effect_${index + 1}`);
    if (used.has(effectName)) throw new Error(`动画的 Effect 名称重复：${effectName}`);
    used.add(effectName);
    return { effectName, animationId: animation.id };
  });
}

async function updateManifest(output, packId, displayName, effectPaths) {
  let manifest;
  if (output.has('manifest.json')) {
    manifest = await parseJson(output.get('manifest.json'), 'manifest.json');
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest.json 必须是 JSON 对象');
    if (!Array.isArray(manifest.effects)) manifest.effects = [];
  } else {
    manifest = { format_version: 1, pack_id: packId, display_name: displayName, effects: [] };
  }
  manifest.format_version ||= 1;
  manifest.pack_id ||= packId;
  manifest.display_name ||= displayName;
  for (const path of effectPaths) if (!manifest.effects.includes(path)) manifest.effects.push(path);
  output.set('manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
}

async function buildPack() {
  const packId = safeId($('packId').value, 'my_effects');
  const displayName = $('displayName').value.trim() || packId;
  const duration = Math.max(1, Math.min(72000, Number.parseInt($('duration').value, 10) || 120));
  const effects = selectedEffects();
  const output = new Map(state.files);
  await normalizeImportedResources(output);
  const existingEntity = firstPath([...output.keys()], (p) => p.includes('/assets/eyelib/entity/') || p.includes('/entity/'));
  const effectPaths = [];

  for (const effect of effects) {
    let entityPath = existingEntity;
    if (!entityPath || effect.animationId) {
      const generated = await generatedEntity(output, effect.effectName, effect.animationId);
      output.clear();
      for (const [path, value] of generated.output) output.set(path, value);
      entityPath = generated.entityPath;
    }
    const effectPath = `effects/${effect.effectName}.json`;
    effectPaths.push(effectPath);
    if (!output.has(effectPath)) {
      const definition = {
        format_version: 1,
        id: `${packId}:${effect.effectName}`,
        duration_ticks: duration,
        client_entity: entityPath
      };
      output.set(effectPath, new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' }));
    }
  }
  await updateManifest(output, packId, displayName, effectPaths);
  return { output, packId, effects };
}

async function directoryForPath(root, path) {
  const parts = path.split('/');
  const fileName = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return { directory, fileName };
}

async function writePack() {
  if (!state.targetRoot) throw new Error('请先选择要写入的客户端版本目录');
  const { output, packId, effects } = await buildPack();
  let directory = await state.targetRoot.getDirectoryHandle('config', { create: true });
  directory = await directory.getDirectoryHandle('yesstevevfx', { create: true });
  directory = await directory.getDirectoryHandle('packs', { create: true });
  directory = await directory.getDirectoryHandle(packId, { create: true });
  for (const [path, value] of output) {
    const { directory: target, fileName } = await directoryForPath(directory, path);
    const handle = await target.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(value instanceof Blob ? value : value);
    await writable.close();
  }
  return { packId, effects, count: output.size };
}

async function chooseTargetRoot() {
  const versionSelect = $('versionSelect');
  state.versions.clear();
  state.targetRoot = null;
  state.targetLabel = '';
  versionSelect.replaceChildren();
  try {
    const versionsDirectory = await state.root.getDirectoryHandle('versions');
    for await (const [name, handle] of versionsDirectory.entries()) {
      if (handle.kind === 'directory') state.versions.set(name, handle);
    }
  } catch (error) {
    // 没有 versions/ 时，按非版本隔离客户端处理。
  }

  const versions = [...state.versions.keys()].sort((a, b) => a.localeCompare(b));
  if (!versions.length) {
    versionSelect.disabled = true;
    versionSelect.append(new Option('未检测到版本隔离，使用当前目录', 'root'));
    state.targetRoot = state.root;
    state.targetLabel = state.root.name;
    $('rootName').textContent = `客户端目录：${state.root.name}`;
    $('targetHint').textContent = '未检测到 versions/，将直接写入这个目录的 config/yesstevevfx。';
    return;
  }

  versionSelect.disabled = false;
  versionSelect.append(new Option(versions.length === 1 ? '已自动选择唯一版本' : '请选择要写入的版本…', ''));
  for (const version of versions) versionSelect.append(new Option(version, version));
  if (versions.length === 1) {
    versionSelect.value = versions[0];
    setTargetVersion(versions[0]);
  } else {
    $('rootName').textContent = `已选择客户端目录：${state.root.name}`;
    $('targetHint').textContent = `检测到 ${versions.length} 个版本，请选择目标版本后再保存。`;
  }
}

function setTargetVersion(version) {
  state.targetRoot = state.versions.get(version) || null;
  state.targetLabel = state.targetRoot ? `${state.root.name}/versions/${version}` : '';
  $('rootName').textContent = state.targetRoot
    ? `写入目标：${state.targetLabel}`
    : `已选择客户端目录：${state.root?.name || ''}`;
  $('targetHint').textContent = state.targetRoot
    ? `资源会写入 ${state.targetLabel}/config/yesstevevfx。`
    : '请选择一个版本目录。';
  renderFiles();
}

$('browserNotice').textContent = 'showDirectoryPicker' in window ? '' : '当前浏览器不支持直接保存，请使用 Chrome/Edge';
$('chooseRoot').addEventListener('click', async () => {
  try {
    if (!('showDirectoryPicker' in window)) throw new Error('浏览器不支持目录写入 API');
    state.root = await window.showDirectoryPicker({ mode: 'readwrite' });
    await chooseTargetRoot();
    setStatus('客户端目录已选择，请确认写入目标版本。', 'success');
    renderFiles();
    writeLog(`客户端目录已选择：${state.root.name}`);
  } catch (error) {
    setStatus(`目录选择失败：${error.message}`, 'error');
    writeLog(error.message, true);
  }
});

$('versionSelect').addEventListener('change', (event) => {
  if (event.target.value) setTargetVersion(event.target.value);
  else {
    state.targetRoot = null;
    renderFiles();
    $('targetHint').textContent = '请选择一个版本目录。';
  }
});

$('selectFiles').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (event) => {
  try { await addFiles([...event.target.files]); }
  catch (error) { setStatus(`导入失败：${error.message}`, 'error'); writeLog(error.message, true); }
  event.target.value = '';
});
$('dropZone').addEventListener('dragover', (event) => { event.preventDefault(); $('dropZone').classList.add('dragging'); });
$('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('dragging'));
$('dropZone').addEventListener('drop', async (event) => {
  event.preventDefault();
  $('dropZone').classList.remove('dragging');
  try { await importDrop(event.dataTransfer); }
  catch (error) { setStatus(`导入失败：${error.message}`, 'error'); writeLog(error.message, true); }
});
$('savePack').addEventListener('click', async () => {
  try {
    const result = await writePack();
    const ids = result.effects.map((effect) => `${result.packId}:${effect.effectName}`);
    const message = `保存完成：${result.count} 个文件、${ids.length} 个 effect 已写入 ${state.targetLabel}/config/yesstevevfx/packs/${result.packId}`;
    setStatus(message, 'success');
    writeLog(`${message}（${ids.join(', ')}）`);
  } catch (error) {
    setStatus(`保存失败：${error.message}`, 'error');
    writeLog(error.message, true);
  }
});
$('clearFiles').addEventListener('click', () => {
  state.files.clear();
  state.animations = [];
  renderFiles();
  renderAnimations();
  setStatus('已清空导入资源。', 'info');
  writeLog('已清空导入资源');
});
for (const input of [$('packId'), $('effectName')]) input.addEventListener('input', updatePreview);
renderAnimations();
updatePreview();
