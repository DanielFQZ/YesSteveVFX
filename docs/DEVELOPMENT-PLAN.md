# YesSteveVFX 开发计划

2026-10-01 更新：[轻量音效后端与 YesSteveSkill 命中联动方案](AUDIO-BACKEND-PLAN.md) 已完成客户端音频、Molang、Blockbench 配置和 YSS 命中桥接；当前继续优化叠音与纯音效包工作流，不扩展全局混音或 DSP。

当前验收基线是 Forge 1.20.1、关闭 Oculus 光影、安装 YSM 与 eyelib。开发顺序先保证特效的模型、动画、粒子状态和跟随表现稳定，再加入额外的屏幕后处理。

## 阶段一：模型与粒子运行时

1. 保持 `config/yesstevevfx` 下的本地资源加载和 reload 校验稳定，并为未来 YSM 通用容器保留 `VfxAssetSource` 接口。
2. 复用 eyelib 的 Bedrock 模型、动画控制器和粒子运行时；一次播放实例只推进一份动画状态，停止时清理对应的粒子发射器。
3. 载体使用客户端本地无碰撞实体。跟随源实体时更新当前坐标和旋转，保留上一 tick 的旧值，让模型和粒子共享 Minecraft 的帧间插值，避免 20 tick/s 的跳动和延迟。
4. 验证单独模型、单独粒子、组合特效、序列帧、alpha 淡出、动画指令帧、多个实例和换世界清理。
5. 当前阶段暂不把 Oculus 光影作为验收条件；光影下的模型渲染兼容单独记录，避免和基础播放问题混在一起。

## 阶段二：控制与资源交付

YSM 通过 Molang 指令帧调用 `ctrl.vfx_play`、`ctrl.vfx_set` 和 `ctrl.vfx_stop`。YesSteveVFX 保持播放实例和渲染生命周期，未来从 YSM 通用文件容器读取同一套 effect 定义和资源字节，不把渲染状态写回 YSM。

独立 VFX 包与随 YSM 模型分发的 `vfx/` 目录共用同一个资源快照和校验流程；目录布局、模型文件键和 YSS/Camera 事件边界见 [YSM-VFX-CONTAINER-PLAN.md](YSM-VFX-CONTAINER-PLAN.md)。

## 阶段三：选择性辉光

辉光功能保留在总体架构中，待阶段一稳定后实现。目标是让指定模型部件或粒子成为辉光来源：复用当前帧已经求值的姿态、颜色和 alpha，绘制到离屏纹理，降采样/模糊后在 HUD 前合成回场景。第一版先支持无光影环境，配置包括来源部件、颜色、强度、半径和开关；不能重复推进动画或重复生成粒子。

辉光实现需要 eyelib 暴露模型额外绘制和粒子额外绘制的稳定入口，YesSteveVFX 负责 Bloom 帧缓冲、模糊、合成和配置解析。Oculus 兼容放在辉光基础流程稳定之后，通过独立兼容层处理渲染阶段、深度和分辨率变化。详细边界见 [BLOOM-FEASIBILITY.md](BLOOM-FEASIBILITY.md)。

## 阶段四：性能与兼容

在基础播放和辉光通过验收后，再处理资源重载、窗口尺寸变化、多个实例的 GPU/CPU 开销，以及 Oculus/特定光影包的可选适配。未启用辉光时不创建额外帧缓冲，也不执行第二次模型或粒子绘制。

## 阶段二点五：多模型编辑工作流与粒子别名稳定化

### 多模型包

Blockbench 插件不在导入时一次性打开所有模型。打开包后先显示模型选择窗口，每个条目按 `geo.json 路径 + geometry 下标` 标识，并显示 geometry identifier、骨骼/cube 数、关联 effect、关联 animation.json、动画数量、动画名称和粒子数量。用户选择一个模型后才创建对应的 Blockbench 标签页；该标签页继续使用源 `geo.json` 的原生保存路径。

VFX 菜单增加“切换模型/打开其他模型”。已打开的模型复用已有 session，未打开的模型新建 session。这样可以支持一个包包含多个 geo 文件，也支持一个 geo 文件包含多个 `minecraft:geometry`，又不会一次创建大量不可区分的标签页。

模型关联索引的来源优先级如下：

1. `manifest.json` → effect JSON → client entity 的 `geometry` 和 `animations`；
2. client entity 的 geometry identifier 与扫描到的 geometry 条目精确匹配；
3. 仅有原始资源而没有实体绑定时，显示“未建立运行时关联”的警告，要求用户手动选择；
4. 禁止在存在多个候选模型时静默选第一个模型。

当前运行时一个 effect 仍对应一个 `geometry.default`。因此“一个包包含多个模型”可以直接支持，但“一个 effect 同时组合多个模型”需要未来扩展为多个模型实例或多个 carrier，暂不与本阶段混合。

### 运行时资产关联

动画 JSON 不记录自己属于哪个模型，它只保存骨骼动画和粒子事件别名。真正的运行时关联由 JSON 链完成：

```text
manifest.json
  -> effects/*.json
    -> entity/*.json (旧包也支持 assets/eyelib/entity/*.json)
      -> geometry / animations / particle_effects / textures / render_controllers
```

动画中的 `particle_effects` 只写短别名，例如 `slash`；client entity 的 `particle_effects.slash` 才把它映射到实际粒子 identifier。`vfx-project.json` 是编辑器配置，只保存源文件绑定、用户选择和粒子贴图关系，运行时不会依赖它。

### 粒子别名问题的结论

已核对 Blockbench 当前源码：

- `js/animations/keyframe.js` 的 `changeKeyframeFile` 在没有现成 `effect` 时，会用粒子文件名去掉扩展名并清理字符后生成别名；
- `js/animations/animation_controllers.js` 使用相同的回退逻辑；
- `js/formats/bedrock/bedrock.js` 只有在加载 client entity 时，才能通过 `description.particle_effects` 把动画短别名解析到粒子 JSON；
- `js/formats/bedrock/bedrock_animation.js` 导出时基本原样序列化 `data_point.effect`，不会在导出阶段替换成粒子 identifier。

所以问题通常不是随机数，而是 Blockbench 在没有完整 client entity 上下文时，把文件名或内部预览名称当成了动画事件别名。动画中出现 `12`、`2`、`3`，很可能就是导入时的文件名回退结果；它们不会自动等于粒子 JSON 的 `description.identifier`。

### 修复优先级

第一层由 YesSteveVFX 插件完成，不要求修改 Blockbench：

1. 为每个粒子保留源文件绝对路径和稳定内部 preview identifier；
2. 新增/修改粒子帧时根据 `data_point.file` 反查源粒子文件；
3. 保存源 animation.json 前，把 preview identifier 或文件名别名规范化为用户确认的事件别名；
4. 绑定键使用“动画文件 + 动画名 + 时间 + 事件序号”，不再只用全局别名；
5. 导出时保证 animation 的事件别名和 client entity 的 `particle_effects` 映射逐项一致；
6. 对旧版仅按别名保存的 `vfx-project.json` 自动迁移，遇到多义绑定时要求用户确认。

第二层在 YesSteveVFX 插件中提供独立的“粒子别名/绑定”面板。用户看到的是事件别名和源粒子文件，Blockbench 的内部显示名称只作为预览信息，不能成为导出依据。

第三层由稳定 Blockbench fork 修复底层行为，适合社区 fork 合并：

1. `changeKeyframeFile` 和 `changeParticleFile` 不再用文件名作为隐式别名；
2. 优先读取粒子 JSON 的 `particle_effect.description.identifier`，并通过 client entity 映射得到短别名；
3. 当没有 client entity 映射时，弹出明确的“事件别名”输入/选择，而不是自动生成数字或清洗后的文件名；
4. `Animator.loadParticleEmitter` 为同一绝对路径复用 emitter，但允许显示名与 runtime identifier 分离；
5. `bedrock_animation.js` 保存时保留用户指定的 `effect` 字符串，不把预览名称写回源文件；
6. 增加测试：两个粒子文件同名、identifier 重复、中文文件名、数字文件名、同一动画多个事件，以及无 client entity 上下文的导入。

这意味着不必等待 Blockbench fork 才能保证 YesSteveVFX 导出的包正确；插件层可以先实现可靠导出。fork 的价值主要是修复原生 Blockbench 粒子时间轴的显示和编辑体验，让其它项目也不再受到同一问题影响。

### 本阶段验收

- 一个包含两个 geo 文件和一个多 geometry 文件的测试包可以逐个选择并打开；
- 每个模型标签页保存后只修改对应 geometry，保留同文件其它 geometry；
- 模型选择窗口能列出关联动画文件和动画数量；
- 新增粒子帧后保存，animation.json 的 `effect` 与 client entity 映射一致；
- 粒子文件名为中文、数字或重复名称时，导出仍能播放正确粒子；
- 不提供 client entity 绑定时，插件给出警告而不是静默猜测。

### 实施记录：2026-09-27 / Studio 0.2.0

已实现多模型选择窗口、按模型复用标签、关联动画与贴图、重新扫描资产，以及逐事件粒子绑定。多个 geo 文件和同一 geo 内多个 geometry 均独立管理；源文件路径保持关联。

修订粒子标识策略：Blockbench 预览按源文件绝对路径索引，保留粒子真实 identifier，不注入虚构的 preview identifier。事件键将时间数值规范化（`0.0` 和原生关键帧 `0` 对应同一时间），但保留 JSON 原时间键用于写回；重复数值时间键拒绝导出。实际选中的 `data_point.file` 优先用于保存时确定粒子身份。普通用户别名保留；同名但指向不同文件的事件转成稳定别名。导出始终在副本中规范化，并同时生成实体映射。

原生动画保存按钮对 VFX 会话增加校正、备份与冲突检查。共享 animation.json 可以同时在多个模型标签中打开，但同一动画条目被其它标签修改后，旧快照禁止覆盖；不同动画条目通过读取最新文件合并保存。模型原生保存继续使用 Blockbench 自身实现。

验证记录：

- Node 回归检查覆盖多模型歧义、重复粒子 identifier、数字/中文同名文件、逐事件绑定、版本 1 配置迁移、动画副本导出及不修改源动画。
- Blockbench 5.2.1 / MCP 实测：两个 geo 文件共三个 geometry 可识别；同一 geo 的两个 geometry 分别打开标签，均载入共享文件中的三个动画。
- 原生保存其中一个 geometry 后，同文件另一个 geometry 内容保持一致。
- 两个都叫 `12` 的事件按实际源粒子文件保存成不同稳定别名；导出检查通过。
- 在过时的另一个模型标签保存同一动画时正确拦截，磁盘内容保持不变。
- 本阶段未修改 Java 运行时，未以游戏内视觉一致性或光影兼容作为验收结论。

使用说明见 `blockbench/README.md`。后续开始对照同一特效在 Blockbench 与游戏中的结果，定位粒子缺失等运行时细节。
