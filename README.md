# YesSteveVFX

YesSteveVFX 是面向 Forge 1.20.1 的客户端特效运行时。一个 effect 由 Bedrock 模型、动画、render controller、纹理和粒子资源组成；YesSteveVFX 管理配置、实例生命周期和 carrier，eyelib 负责实际的 Bedrock 模型、动画和粒子渲染，YSM 只负责通过 Molang 指令帧控制播放。当前构件支持 Forge 1.20.1 的 47.0.0 至 47.x 版本。

当前工作版本为 `1.0.0-pre.2-audio.1` 音效测试版。视觉特效需要 Forge 1.20.1、eyelib；YSM 动画控制还需要 YSM。新音效模块使用 Minecraft 原版声音系统，支持单声道 OGG 短音效、位置/跟随播放、Molang 控制，以及 Blockbench 音效管理。纯音效包不要求 eyelib。

音效配置与测试步骤见 [音效使用说明](docs/AUDIO-USER-GUIDE.md)。DanielFQZ 的 YSS fork 已加入 `YssHitResolvedEvent`，VFX 会在检测到该事件时启用可选命中音效桥；上游 PR 是否合并不影响没有 YSS 时的普通音效功能。

运行时关系如下：

```text
YSM animation / Molang
        │ ctrl.vfx_play / stop / set
        ▼
YesSteveVFX client runtime
        │ LivingEntity carrier
        ▼
eyelib entity renderer, animation and particle pipeline
```

VFX carrier 是客户端本地的无碰撞 ArmorStand，不参与游戏逻辑，也不需要服务端 NPC 插件。它只是让 eyelib 可以复用自己的 `LivingEntity` 渲染入口；carrier 保留上一 tick 的变换并更新当前变换，让模型和粒子沿着与触发特效的 YSM 实体相同的帧间插值轨迹跟随。

## 本地资源

资源放在客户端游戏目录：

```text
config/yesstevevfx/packs/<pack_id>/
├── manifest.json
├── effects/<effect>.json
└── assets/eyelib/
    ├── entity/*.json
    ├── models/*.json
    ├── animations/*.json
    ├── animation_controllers/*.json
    ├── render_controllers/*.json
    ├── particles/*.json
    └── textures/*
```

最小 manifest 和 effect 定义：

```json
{
  "format_version": 1,
  "pack_id": "demo",
  "display_name": "Demo",
  "effects": ["effects/demo.json"]
}
```

```json
{
  "format_version": 1,
  "id": "yesstevevfx:demo",
  "duration_ticks": 60,
  "client_entity": "assets/eyelib/entity/demo.json"
}
```

可直接复制仓库中的 [examples/demo](examples/demo) 到 `config/yesstevevfx/packs/demo` 进行测试。加载器会在发布前完整读取和校验资源，并拒绝未知字段、路径穿越、符号链接、重复 ID 以及超出大小预算的资源。

仓库中的 [examples/test_effect](examples/test_effect) 还包含 `test1` 到 `test5` 五个组合测试：前三个同时包含模型动画和粒子，`test4` 只包含模型动画，`test5` 只包含粒子。复制后执行 `/vfx_client reload`，再分别播放 `yesstevevfx:test1` 到 `yesstevevfx:test5`。

面向资源作者的配置说明见 [docs/USAGE.md](docs/USAGE.md)。

YSM 动画指令帧的完整接入示例见 [docs/YSM-INTEGRATION.md](docs/YSM-INTEGRATION.md)，Molang 函数参数和返回值规范见 [docs/MOLANG-REFERENCE.md](docs/MOLANG-REFERENCE.md)。

## Web 可视化编辑器

仓库提供一个无需 Node.js 的静态编辑器，适合不熟悉 JSON 的用户组装单个模型/动画/粒子特效包。启动本地静态服务器：

```powershell
python -m http.server 8080 -d editor
```

然后打开 <http://localhost:8080>，选择客户端的 `.minecraft` 根目录，把 Blockbench/eyelib 资源文件或完整资源目录拖入页面。编辑器会读取每个 `.animation.json` 中的全部动画，逐项显示启用开关和可编辑的 Effect 名称，因此一份动画文件可以批量生成多个 effect。Chrome 和 Edge 会通过 File System Access API 将文件写入 `config/yesstevevfx/packs/<pack_id>/`；浏览器首次保存时会请求目录写入权限。检测到 `versions/` 时，编辑器会要求选择具体版本目录后才允许保存，避免写入错误的隔离实例。导入、保存和异常都会显示明确状态，编辑器会保留已有的 manifest、effect、client entity 和 render controller，缺少的基础配置会自动生成。

更详细的操作步骤和当前编辑器支持范围见 [editor/README.md](editor/README.md)。复杂的多实体关系、材质变量和动画 controller 仍可直接编辑生成目录中的 JSON。

## Blockbench 一站式编辑器

仓库中的 [`blockbench/yesstevevfx_studio.js`](blockbench/yesstevevfx_studio.js) 是桌面版 Blockbench 插件。它可以导入整个 VFX 文件夹，列出模型、动画、粒子、贴图和实体关系；动画时间轴里的每个粒子事件都要显式绑定到粒子 JSON，避免 Blockbench 的数字别名或同名 identifier 导致资源错配。插件可以调用 Blockbench 自带预览来同时播放模型动画和粒子，并把编辑后的模型/动画写回源工程（写回前自动备份）。

安装和使用说明见 [blockbench/README.md](blockbench/README.md)。插件导出到客户端时会识别 `versions/` 下的隔离实例，将旧包移到 `vfx-backups`，不会把备份目录放入 `packs`。

## 控制接口

YSM bridge 在包含 YSM 的客户端构件中注册以下 Molang 函数。函数返回 `1` 表示请求已接受，返回 `0` 表示参数、实体或 effect 不可用：

```text
ctrl.vfx_play("yesstevevfx:demo", "main")
ctrl.vfx_stop("main")
ctrl.vfx_set("main", "scale", 1.25)
```

函数只接受客户端真实实体的动画上下文，不接受预览实体、fake player 或没有 `allowEmitting()` 权限的上下文。YSM bridge 不保存 YSM Entity、Molang Context 或 AST 引用。

`audio.json` 的 `hit_bindings` 由 YSS 服务端确认事件驱动：需要服务端和客户端都安装带事件的 YSS，以及双方的 VFX。VFX 服务端只转发 model ID、动画名、段下标和目标位置，客户端使用自己加载的音效表匹配播放；没有匹配绑定时静默跳过。

## 本地手动测试命令

核心模组提供客户端命令，默认把本地玩家作为 effect 的源实体：

```text
/vfx_client reload
/vfx_client play yesstevevfx:demo test
/vfx_client set test scale 1.25
/vfx_client stop test
```

如果没有 eyelib，资源仍会被加载和校验，但 play 不会创建可见模型；带 eyelib 的构件才会安装真实渲染后端。

## 构建

ForgeGradle/ModDev 构建需要 Java 17 或更高版本，目标字节码仍为 Java 17：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.5.11-hotspot'
./gradlew.bat build
```

YSM 和 eyelib 是可选 source set。拿到对应的 1.20.1 JAR 后，使用：

```powershell
./gradlew.bat build `
  -PysmJar='D:\libs\ysm-1.20.1.jar' `
  -PeyelibJar='D:\libs\eyelib-1.20.1.jar'
```

默认构建使用 Forge `1.20.1-47.4.16`。验证较低的 1.20.1 Forge 时，可以切换构建目标，例如：

```powershell
./gradlew.bat build `
  -PforgeVersion='1.20.1-47.1.0' `
  -PysmJar='D:\libs\ysm-1.20.1.jar' `
  -PeyelibJar='D:\libs\eyelib-1.20.1.jar'
```

构建目标必须仍是 Minecraft 1.20.1；Forge 版本范围由 JAR 的 `mods.toml` 声明为 `[47.0.0,48)`。eyelib 和 YSM 自身的 Forge 依赖范围仍需分别满足，降低 Forge 版本时应同时检查这两个 MOD 的元数据。

不传这两个属性时，核心构件不链接任何 YSM 或 eyelib 私有类；传入属性时，bridge 类会被编译并合并进最终 JAR。当前仓库已用 JDK 21 验证完整构建和资源加载测试。eyelib 自身构建若因其 Stonecutter/Gradle 环境失败，需要先由 eyelib 提供可用构件，VFX 代码不应复制 eyelib 的渲染实现。

## 兼容边界

- VFX 资源只进入 `yesstevevfx` 命名空间，reload 只清理本 MOD 自己发布的 eyelib 资源。
- stop 会停止特效实例和它跟踪的粒子发射器；已经生成的粒子会按自己的寿命结束。
- 换世界、退出服务器和 effect duration 到期时都会移除 carrier。
- `VfxApi` 可供其他 MOD 直接调用 `play(UUID, effectId, slot)`、`stop(UUID, slot)` 和 `set(UUID, slot, name, value)`，在专用服务器上会安全返回 `false`。

