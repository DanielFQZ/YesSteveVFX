const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-multimodel-'));
  function put(file, json) {
    const dest = path.join(root, file);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, JSON.stringify(json, null, 2));
  }
  const geo = id => ({description: {identifier: id, texture_width: 16, texture_height: 16},
    bones: [{name: 'root', pivot: [0, 0, 0], cubes: [{origin: [-1, 0, -1], size: [2, 2, 2], uv: [0, 0]}]}]});
  put('models/甲.geo.json', {format_version: '1.12.0', 'minecraft:geometry': [geo('geometry.a')]});
  put('models/乙.geo.json', {format_version: '1.12.0', 'minecraft:geometry': [geo('geometry.b'), geo('geometry.c')]});
  put('animations/完整.animation.json', {format_version: '1.8.0', animations: {
    'animation.demo.one': {animation_length: 2, particle_effects: {'0.0': [{effect: '12'}, {effect: '12'}]}},
    'animation.demo.two': {animation_length: 2, bones: {root: {rotation: [0, 'query.anim_time * 90', 0]}}},
    'animation.demo.three': {animation_length: 2}
  }});
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../examples/test_effect/assets/eyelib/particles/particle1.json'), 'utf8'));
  example.particle_effect.description.identifier = 'duplicate:particle';
  example.particle_effect.description.basic_render_parameters.texture = 'textures/color';
  put('particles/12.json', example);
  put('particles/中文/12.json', example);
  fs.mkdirSync(path.join(root, 'textures'));
  fs.copyFileSync(path.resolve(__dirname, '../../examples/test_effect/assets/eyelib/textures/test.png'), path.join(root, 'textures/color.png'));
  return root;
}
module.exports = {fixture};
