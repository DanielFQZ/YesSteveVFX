const state = { root: null, files: new Map() };
const $ = (id) => document.getElementById(id);

function writeLog(message, error = false) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  const log = $('log');
  log.textContent = `${log.textContent === '等待操作…' ? '' : `${log.textContent}\n`}${line}`;
  log.style.color = error ? 'var(--danger)' : '';
}

function safeId(value, fallback) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '');
  return normalized || fallback;
}

function updatePreview() {
  const pack = safeId($('packId').value, 'my_effects');
  const effect = safeId($('effectName').value, 'demo');
  $('effectIdPreview').textContent = `${pack}:${effect}`;
}

function renderFiles() {
  const paths = [...state.files.keys()].sort();
  $('fileSummary').textContent = paths.length ? `已导入 ${paths.length} 个文件` : '还没有导入资源';
  $('fileList').replaceChildren(...paths.map((path) => {
    const item = document.createElement('li');
    item.textContent = path;
    return item;
  }));
  $('savePack').disabled = !paths.length || !state.root;
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
  if (lower.endsWith('.animation.json') || lower.includes('/animations/')) return `assets/eyelib/animations/${name}`;
  if (lower.includes('render_controller') || lower.includes('/render_controllers/')) return `assets/eyelib/render_controllers/${name}`;
  if (lower.includes('particle') || lower.includes('/particles/')) return `assets/eyelib/particles/${name}`;
  if (lower.includes('entity') || lower.includes('client_entity')) return `assets/eyelib/entity/${name}`;
  if (/\.(png|jpe?g)$/i.test(name)) return `assets/eyelib/textures/${name}`;
  return `assets/eyelib/misc/${name}`;
}

async function addFiles(files) {
  for (const item of files) {
    const file = item.file || item;
    const sourcePath = item.path || file.webkitRelativePath || file.name;
    const path = normalizedImportedPath(sourcePath);
    state.files.set(path, file);
  }
  renderFiles();
  writeLog(`导入资源：${state.files.size} 个文件`);
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

function geometryIdentifier(json, fallback) {
  const entries = json?.['minecraft:geometry'];
  return entries?.[0]?.description?.identifier || fallback;
}

function animationIdentifier(json, fallback) {
  const animations = json?.animations;
  return animations && Object.keys(animations)[0] || fallback;
}

function renderControllerIdentifier(json, fallback) {
  const controllers = json?.render_controllers;
  return controllers && Object.keys(controllers)[0] || fallback;
}

async function generatedEntity(files, effectName) {
  const paths = [...files.keys()];
  const modelPath = firstPath(paths, (p) => p.endsWith('.geo.json'));
  const animationPath = firstPath(paths, (p) => p.endsWith('.animation.json'));
  const renderPath = firstPath(paths, (p) => p.includes('/render_controllers/'));
  const texturePath = firstPath(paths, (p) => p.includes('/textures/') && /\.(png|jpe?g)$/.test(p));
  const particlePaths = paths.filter((p) => p.includes('/particles/') && p.endsWith('.json'));
  const modelJson = modelPath ? await parseJson(files.get(modelPath), modelPath) : null;
  const animationJson = animationPath ? await parseJson(files.get(animationPath), animationPath) : null;
  const renderJson = renderPath ? await parseJson(files.get(renderPath), renderPath) : null;
  const geometry = geometryIdentifier(modelJson, `geometry.yesstevevfx.${effectName}`);
  const animation = animationIdentifier(animationJson, `animation.yesstevevfx.${effectName}`);
  const renderController = renderControllerIdentifier(renderJson, `controller.render.yesstevevfx.${effectName}`);
  const texture = texturePath ? `yesstevevfx:textures/${withoutExtension(texturePath.split('/textures/')[1])}` : `yesstevevfx:textures/${effectName}`;
  const particles = {};
  for (const path of particlePaths) {
    const short = path.split('/').pop().replace(/\.json$/i, '');
    const json = await parseJson(files.get(path), path);
    const id = json?.particle_effect?.description?.identifier || json?.['particle_effect']?.description?.identifier;
    particles[short] = id || `yesstevevfx:${effectName}/${short}`;
  }
  const entity = {
    'minecraft:client_entity': {
      description: {
        identifier: `yesstevevfx:${effectName}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: texture },
        geometry: { default: geometry },
        animations: { main: animation },
        particle_effects: particles,
        render_controllers: [renderController],
        scripts: { animate: ['main'] }
      }
    }
  };
  const output = new Map(files);
  output.set(`assets/eyelib/entity/${effectName}.json`, new Blob([JSON.stringify(entity, null, 2)], { type: 'application/json' }));
  if (!renderPath) {
    const controller = { render_controllers: { [renderController]: { geometry: 'Geometry.default', materials: ['Material.default'], textures: ['Texture.default'] } } };
    output.set(`assets/eyelib/render_controllers/${effectName}.json`, new Blob([JSON.stringify(controller, null, 2)], { type: 'application/json' }));
  }
  return { output, entityPath: `assets/eyelib/entity/${effectName}.json` };
}

async function buildPack() {
  const packId = safeId($('packId').value, 'my_effects');
  const effectName = safeId($('effectName').value, 'demo');
  const displayName = $('displayName').value.trim() || packId;
  const duration = Math.max(1, Math.min(72000, Number.parseInt($('duration').value, 10) || 120));
  const output = new Map(state.files);
  const existingEntity = firstPath([...output.keys()], (p) => p.includes('/assets/eyelib/entity/') || p.includes('/entity/'));
  const entityPath = existingEntity || `assets/eyelib/entity/${effectName}.json`;
  if (!existingEntity) {
    const generated = await generatedEntity(output, effectName);
    output.clear();
    for (const [path, value] of generated.output) output.set(path, value);
  }
  if (!output.has('manifest.json')) {
    const manifest = { format_version: 1, pack_id: packId, display_name: displayName, effects: [`effects/${effectName}.json`] };
    output.set('manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
  }
  const effectPath = `effects/${effectName}.json`;
  if (!output.has(effectPath)) {
    const effect = { format_version: 1, id: `${packId}:${effectName}`, duration_ticks: duration, client_entity: entityPath };
    output.set(effectPath, new Blob([JSON.stringify(effect, null, 2)], { type: 'application/json' }));
  }
  return { output, packId, effectName };
}

async function directoryForPath(root, path) {
  const parts = path.split('/');
  const fileName = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return { directory, fileName };
}

async function writePack() {
  if (!state.root) throw new Error('请先选择 .minecraft 客户端目录');
  const { output, packId, effectName } = await buildPack();
  let directory = await state.root.getDirectoryHandle('config', { create: true });
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
  return { packId, effectName, count: output.size };
}

$('browserNotice').textContent = 'showDirectoryPicker' in window ? '' : '当前浏览器不支持直接保存，请使用 Chrome/Edge';
$('chooseRoot').addEventListener('click', async () => {
  try {
    if (!('showDirectoryPicker' in window)) throw new Error('浏览器不支持目录写入 API');
    state.root = await window.showDirectoryPicker({ mode: 'readwrite' });
    $('rootName').textContent = `已选择：${state.root.name}`;
    renderFiles();
    writeLog(`客户端目录已选择：${state.root.name}`);
  } catch (error) { writeLog(error.message, true); }
});

$('selectFiles').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (event) => addFiles([...event.target.files]));
$('dropZone').addEventListener('dragover', (event) => { event.preventDefault(); $('dropZone').classList.add('dragging'); });
$('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('dragging'));
$('dropZone').addEventListener('drop', async (event) => {
  event.preventDefault();
  $('dropZone').classList.remove('dragging');
  try { await importDrop(event.dataTransfer); } catch (error) { writeLog(`导入失败：${error.message}`, true); }
});
$('savePack').addEventListener('click', async () => {
  try {
    const result = await writePack();
    writeLog(`已保存 ${result.count} 个文件到 config/yesstevevfx/packs/${result.packId}，effect=${result.packId}:${result.effectName}`);
  } catch (error) { writeLog(`保存失败：${error.message}`, true); }
});
$('clearFiles').addEventListener('click', () => { state.files.clear(); renderFiles(); writeLog('已清空导入资源'); });
for (const input of [$('packId'), $('effectName')]) input.addEventListener('input', updatePreview);
updatePreview();
