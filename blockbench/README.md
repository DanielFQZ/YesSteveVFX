# YesSteveVFX Studio（Blockbench 插件）

这是桌面版 Blockbench 插件，用来把一个 VFX 文件夹导入 Blockbench，检查模型、动画、粒子绑定，直接预览，然后写回源文件并导出到 Minecraft 客户端。预览打开时会先载入 geo.json，再把 animation.json 导入当前 Bedrock 模型工程，并把包内全部粒子 JSON 注册到 Blockbench 的粒子库。它需要读取目录和写入文件，网页端 Blockbench 不支持这套工作流。

## 安装

1. 确认文件名保持 **`yesstevevfx_studio.js`**，不要改成 `yesstevevfx.js` 或中文文件名。Blockbench 会用文件基本名校验插件 ID。
2. 在 Blockbench 打开“文件 → 插件”，点击右上角菜单中的“加载插件”，选择 `YesSteveVFX/blockbench/yesstevevfx_studio.js`。
3. 如果旧文件已经加载过，先在插件列表禁用或卸载旧的 `yesstevevfx`，再加载带 `_studio` 后缀的文件。加载成功后，在顶部的 **工具** 菜单中会出现以“VFX：”开头的操作。

## 一次完整操作

1. 点击 **工具 → VFX：导入工程文件夹**，选择一个包含模型、动画、粒子 JSON 和 PNG 的目录。可以直接选择客户端里的 `config/yesstevevfx/packs/<pack_id>`，也可以选择尚未导出的源工程目录。
2. 导入后会自动打开第一个 effect 的 Bedrock 模型工程：先载入 geo.json，再一次性载入它引用的完整 animation.json。动画模式的动画列表会显示文件中的全部动画（例如 `test1` 到 `test5`），当前 effect 对应的动画会被自动选中；开发者可以在列表中自行切换预览。插件同时注册包内全部粒子，顶部会显示扫描到的模型、动画、粒子和贴图数量；需要重新绑定时可通过工具菜单打开 **YesSteveVFX · 资产与绑定**。
3. 在资产与绑定窗口左侧选择一个 effect。动画文件中的每个动画都会单独列出；不想导出的动画取消左侧复选框即可。可以修改 effect 名称和持续时间，并选择模型、模型贴图和动画。
4. 在“动画事件别名 → 粒子文件”区域为每个粒子事件选择 JSON。Blockbench 生成的数字别名（例如 `12`、`2`、`3`）必须手动绑定；不要只根据文件名猜测。粒子页可以修改贴图引用，也可以点“编辑粒子 JSON”。
5. 点击 **检查引用**。只有没有未绑定粒子、贴图、定位器和非法 ID 时才导出。检查通过后点击 **打开 / 更新 Blockbench 预览**。插件会先打开模型，再导入完整的 animation.json，并注册该包的全部粒子；进入动画模式后可在动画列表切换任意动画，按空格播放，在粒子时间轴中可以直接选择已注册粒子。定位器、骨骼和动画都可以使用 Blockbench 原有工具编辑。
6. 编辑完成后，在预览标签中点击 **工具 → VFX：保存当前编辑回工程**。插件会先把将要覆盖的文件备份到源工程同级的 `<工程名>-edit-backups/<时间戳>/`，再写回模型和动画 JSON。只打开资产绑定窗口而没有预览标签时，不能执行这个菜单项。
7. 回到资产与绑定窗口，点击 **导出到客户端**。选择 `.minecraft` 根目录；如果里面有 `versions`，插件会列出每个版本目录，选择实际运行 YSM/eyelib 的版本。旧包会移到 `config/yesstevevfx/vfx-backups/`，不会放入 `packs`。
8. 进入游戏执行：

```text
/vfx_client reload
```

然后播放某个 effect：

```text
/vfx_client play `<pack_id>:<effect_name>` test
```

例如：

```text
/vfx_client play test_effects:test1 test
```

插件工程配置保存为 `vfx-project.json`。它记录 effect 名称、持续时间、动画选择以及每个动画粒子事件到粒子 JSON 的绑定；它不复制大型资源，因此源工程目录必须保持完整。

## 用预览定位“粒子不完整”

先在 Blockbench 预览里播放同一个动画，再在游戏里播放导出的 effect：

- Blockbench 预览也缺粒子：优先检查动画的 `particle_effects`、事件别名绑定、定位器和粒子 JSON 的贴图引用。
- Blockbench 预览完整、游戏缺粒子：检查导出后的 `assets/eyelib/particles`、实体 `particle_effects` 映射和游戏 `latest.log`；这通常属于导出包或运行时链路。
- 预览和游戏都完整：问题可能来自触发时机、粒子寿命、视距或运行时渲染器，而不是资源绑定。

预览窗口使用的是 Blockbench 自己的粒子模拟，和游戏中的 eyelib 渲染并非同一实现，因此它适合确认“资源和事件是否完整”，不能用来证明光影或游戏渲染一定相同。

## 常见问题

- **动画列表看起来是空白**：打开预览时插件会自动展开动画面板及其所在的组合面板，清除动画搜索并展开动画分组。若之后手动折叠了面板，点击“动画”标题旁的展开箭头；面板与 MCP 共用容器时，需要展开整个容器。
- **切换特效包**：再次点击“工具 → VFX：导入工程文件夹”会重新打开系统目录选择窗口；取消选择会保留当前工程。已有预览标签会保留，避免丢失编辑。
- **提示文件名和插件 ID 不一致**：文件必须叫 `yesstevevfx_studio.js`，并重新从“加载插件”选择它。
- **导入后没有 effect**：确认目录中有 `.animation.json`，或至少有 `manifest.json` 与 `effects/*.json`；然后点击 工具 → VFX：导入工程文件夹重新扫描。
- **检查引用提示贴图未绑定**：打开“粒子与贴图”页，为每个粒子选择序列帧 PNG；模型也要单独选择模型贴图。
- **保存当前编辑回工程失败**：先点击一个 effect 的“打开 / 更新 Blockbench 预览”，再在该预览标签中执行保存。
- **导出后 reload 失败**：不要把 `vfx-backups` 或编辑备份复制到 `packs`；重新导出会自动把旧包移到备份目录。

第一版暂时不导出声音事件、动画控制器和子粒子事件。它们会在检查引用时明确提示，原始 JSON 不会被静默修改。




