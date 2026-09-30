# 轻量音效后端与 YesSteveSkill 命中联动方案

日期：2026-10-01。状态：`1.0.0-pre.2-audio.2` 已实现客户端音频后端、Molang 播放/停止、Blockbench 音效管理及测试包；YSS fork 已增加最小 `YssHitResolvedEvent`，VFX 已接入可选反射桥和命中 S2C。使用步骤见 [AUDIO-USER-GUIDE.md](AUDIO-USER-GUIDE.md)。

## 1. 第一版目标与技术选择

目标平台为 Forge 1.20.1 / Java 17。首先解决技能施放、挥刀和命中短音效：能够在 YSM 动画指令帧中播放/停止声音，以及在 YesSteveSkill（YSS）服务端认可的伤害命中后播放声音。

第一版在 YesSteveVFX 内增加独立 `audio` 模块，使用 Minecraft `SoundManager`、`SoundInstance` 和原版 OGG 解码输出。它支持多个声音实例、空间定位、距离衰减和游戏音量分类，不要求额外安装 Melody，也不要求 eyelib 承担音频播放。视觉效果和声音可以分别使用。

对前期调研结论的收敛：Melody 1.20.1 的 `AudioClip` 更适合背景音乐，未提供现成世界坐标接口，并要求调用方处理音源重建。为本次简单技能音效引入它不会减少接入工作。EmpyreanSoundMix 的空间化、DSP、侧链还有待实现，不能当作可直接移植的已完成功能。

本次不做全局混音接管、BGM/网络音频、MP3/WAV、DSP、侧链、骨骼声源、循环音和服务器下发音频文件。以后可把 `AudioBackend` 适配到高版本 EmpyreanSoundMix，保留资产 ID、播放句柄和控制语义。

## 2. 已核对的接口与限制

- VFX：`src/ysm/java/com/elfmcys/ysmvfx/compat/ysm/YsmIntegration.java` 已在 YSM 解析动画前注册 `ctrl.vfx_*`，通过 `allowEmitting()` 限制动作执行，并将 UUID/参数排队；音频复用这一方式。
- VFX：`LocalVfxAssetSource.load()` 当前只返回以 effect 为索引的资源集合；空 `effects` 包不会保留可供音频消费的包。因此需要包级资源目录，不能仅在 `EyelibBackend.parse()` 增加一个 OGG 分支。
- eyelib：动画音效 `SoundPlayer` 是全局单个回调，不携带播放实例/来源实体标识；`SoundAssetRegistry.stageSounds()` 会整体替换资源。第一版不覆盖这个回调或注册表。Bedrock `sound_effects` 帧接入另作后续扩展，本次入口是 YSM 的 Molang 指令帧。
- 已通过认证读取 [TT432/yessteveskill](https://github.com/TT432/yessteveskill)，核对上游 `master` 提交 `7fad4e64f789d1f31b3c58532d8821099711e541`。本地 `E:/JavaProject/YesSteveSkill` 的相关三个运行时/网络文件与上游一致。
- YSS：`YssAttackRuntime` / `YssAttackService` 做客户端候选碰撞检测，`YssNetwork.sendHitEvent` 发 C2S；`YssAttackServerExecutor.executeHitEvent` 检查配置、时间窗、距离、视线和频率，再执行伤害/机制。这不是服务端重算全部骨骼碰撞。
- YSS：`applyHit` 内 `target.hurt(...)` 的返回值控制是否继续执行击退；`tryFirePending` 处理停帧后的延迟出伤。即时和延迟路径都要覆盖。
- YSS：当前唯一相关 S2C 是 `CombatStateSyncPacket`，包含停帧、打断、击飞等状态，没有技能/判定段/成功伤害信息。当前没有公开的成功命中事件，不能把停帧、挥手或 C2S 请求当作成功命中。
- YSS 网络的 `segmentId` 实际是从 0 开始的列表下标，区别于 `HitSegment.id` 字符串。

## 3. 用户使用方式：施法/挥刀

仍在 Blockbench 编辑 YSM 动画的“动画效果 → 指令”，填写：

```molang
ctrl.vfx_play('yesstevevfx:slash', 'skill_fx');
ctrl.vfx_sound_play('yesstevevfx:combat/slash', 'swing');
```

在需要结束声音的帧写：

```molang
ctrl.vfx_sound_stop('swing');
```

只新增两个 Molang 函数，固定参数数量：

| 函数 | 行为 |
| --- | --- |
| `ctrl.vfx_sound_play(sound_id, slot)` | 在当前 YSM 实体位置播放已加载音效；相同来源 UUID + slot 的多次调用允许叠加 |
| `ctrl.vfx_sound_stop(slot)` | 停止该来源实体该音频槽位的声音；不影响视觉特效同名槽位 |

音量、音高、跟随和距离写在音效配置中，第一版无需长参数列表。函数返回 `1` 只表示校验后接受排队，`0` 表示资源/上下文/参数/队列容量不满足；不代表已经听到声音。停止合法但不存在的槽位是无害操作。

`play` 默认采样实体在执行队列时的位置并固定；配置 `follow: true` 则后续跟随来源实体。声音自然结束时释放句柄。播放不是全局单曲切换，不同实体、不同 slot 可以同时发声。

第一版 Molang 作用于执行指令的本地客户端，不发送广播。旁观者是否听见施法声取决于其客户端是否评估该实体的 YSM 指令帧；不能承诺未渲染实体/第一人称等所有情境必定触发。完整技能施放广播不属于第一版，验收需明确第一人称与第三人称触发情况。

## 4. 资源格式

每个包可选一个根目录 `audio.json`，无此文件的视觉包保持现有行为。支持 `effects: []` 的纯音效包，不要求空模型或 eyelib 实例。目录示例：

```text
config/yesstevevfx/packs/combat/
  manifest.json
  audio.json
  effects/...
  models/                  # Bedrock 模型
  animations/              # Bedrock 动画
  particles/               # Bedrock 粒子
  textures/                # 贴图
  sounds/                  # OGG 音效
    挥刀.ogg
    命中.ogg
```

`manifest.json` 继续使用现有 version 1，`audio.json` 使用独立 version 1；旧 JAR 没有音效功能。音效文件真实路径可含中文，逻辑 ID 仍限制为 Minecraft 合法小写 `namespace:path`，编辑器不因运行时 ID 转换而重命名文件。

```json
{
  "format_version": 1,
  "sounds": {
    "yesstevevfx:combat/slash": {
      "file": "sounds/挥刀.ogg",
      "volume": 1.0,
      "pitch": 1.0,
      "range": 24.0,
      "follow": true
    },
    "yesstevevfx:combat/hit": {
      "file": "sounds/命中.ogg",
      "volume": 1.0,
      "pitch": 1.0,
      "range": 24.0,
      "follow": false
    }
  },
  "hit_bindings": [
    {
      "model_id": "example_model",
      "animation": "attack_1",
      "segment_index": 0,
      "sound": "yesstevevfx:combat/hit"
    }
  ]
}
```

`model_id` 使用 YSM 当前模型对外公开的 `displayPath`（YSM `CustomEntity.getModelId()` 返回值）。YSS 只转发并使用这个 YSM 模型 ID 查找自己的攻击判定工程，不需要用户另行寻找一套 YSS 模型 ID；YSS 工程目录可以是该路径经过归一化后的本地名称。它不是 VFX 的 `geometry.*` 标识，也不是 YSM 内部资源协议使用的哈希值。`animation` 是 YSM 动画名，同时必须存在于 YSS 的 `hit.json -> animations`；`segment_index` 对应 YSS `segments` 数组的零基顺序，调整段顺序后必须重新确认映射。

字段规则：file 必填且在当前包内；volume 默认 1，范围 0..1；pitch 默认 1，范围 0.5..2；range 默认 24，范围 1..64 格；follow 默认 false。第一版固定使用 `SoundSource.PLAYERS`，跟随 Minecraft“主音量”和“玩家”音量滑块。range 定义为 volume=1 时原版线性距离衰减范围，不能只靠放大音量伪造。

仅支持 OGG Vorbis 短音效，最长 10 秒，单文件最多 4 MiB；第一版位置音效要求单声道，立体声在导入/校验时明确提示转换，避免有声音却没有正确方位。非法/截断 OGG 在后台预检失败时报告具体包和文件，不留到技能第一次播放才发现。

跨包音效 ID 重复、同一命中 selector 重复和不存在的本包音效引用均报错；第一版命中绑定只允许引用本包音效，无通配符/优先级系统。

## 5. 客户端实现

```text
YSM timeline -> Molang bridge -> AudioActionQueue -> AudioRuntime
                                                   |
YSS confirmed-hit S2C -> hit binding lookup ----------+
                                                   |
                                     MinecraftAudioBackend
                                                   |
                         SoundManager / TickableSoundInstance
```

- 新建包级 `VfxAssetCatalog`，每个包保留一次不可变资源快照，同时提供效果索引和音效索引；音效不能随 effect 数量被重复装载。`VfxAssetSource` 将来可从 YSM 容器提供相同数据。
- 使用独立 `VfxAudioResourcePack`，通过 Forge 资源包发现事件挂载固定 `yesstevevfx` 命名空间，合成 `sounds.json` 和音频流。中文真实文件路径映射为合法的内部虚拟资源路径（带包隔离/版本标识）；虚拟 ID 不写回用户文件。禁止覆盖 eyelib 全局声音资产，也不向 `.minecraft/assets` 搬文件。
- `MinecraftAudioBackend` 只使用 MC 音频系统，不自行创建 OpenAL context/thread；动态自定义 SoundInstance 保持必要的位置、生命周期与距离配置。原版声音事件资源与 SoundEvent 注册表分离，无需为 reload 后新增的每个音效注册 Forge SoundEvent。
- 资源 reload 要重读 `sounds.json`；不能误用仅重启 SoundEngine 的无参 reload。实现时使用 1.20.1 的正确资源重载流程，完成后才发布新 catalog。优先可靠的资源重载路径，不以“只刷新一个表”牺牲一致性。
- 新旧 catalog 以 generation 管理：先完成配置/OGG 预检，再进行资源重载。失败恢复旧资源索引并重新加载，成功清理旧声音/旧排队命令并发布新 generation。旧声音可能因音频引擎重载停止，但不能出现半新半旧的资产索引。
- Molang 线程只记录 UUID、ID、slot、generation 和世界会话标识，操作 SoundManager 在客户端主线程；不要保存 IContext/Entity/AST。复用 YSM 的动作权限与时间轴单次执行规则，不按每个渲染 pass 播放。
- 不使用“同 tick 同音效 ID”粗暴去重：不同玩家、合法的不同关键帧和多目标命中可以同时发声；额外防重需要可靠的事件身份，不能用位置猜测。
- 默认最大活动声音 32、每来源实体 8、动作队列 256；同一 slot 的 play 允许叠加，stop 按 slot 停止该组全部声音，超限时淘汰最早创建实例。音频解码有独立预算（累计预检 PCM 最多 64 MiB），与现有压缩资源预算分别计数；预检不保留第二份长期 PCM 缓存。
- 声音自然结束、主动 stop、跟随实体消失、离开世界、断线和成功 reload 都清理引用。固定位置短音效允许在来源实体消失后自然播完；世界切换必须停止。暂停/恢复与 MC 保持一致。
- 模块边界：`AudioBackend.play(request) -> AudioHandle`、`stop(handle)`、`clear()`、资源重载接口；外部只接触 sound ID/句柄，不暴露 OpenAL source。未来迁移 ESM 不改变 Molang 和包配置。

## 6. 命中音效：必要的小型 YSS 扩展

固定时间的动画帧只能表达“挥刀到这里”，不能证明命中敌人。因此命中音不要求作者猜一个时间点再写 play，而是根据上面的 `hit_bindings` 自动触发。第一版不引入 `arm_hit_sound` 一类临时监听脚本，以免产生跨技能遗留状态、延迟回包和旁观者不同步。

本版把“成功命中”定义为 **YSS 正伤害段实际调用 `hurt(...)` 返回 true**，不等同于“客户端碰撞到了”，也不声称一定扣除了多少生命。空挥、服务端拒绝和 hurt 返回 false 都不播放；零伤害控制段、格挡/碰撞专用音以后另加。延迟出伤在实际执行 hurt 成功时发声，不在进入停帧时预播。

YSS 最小改动（在独立 fork 提交，不替换用户安装的 YSS）：

1. 在即时与延迟执行路径共享的伤害处理处返回/生成明确的伤害接受结果，在 `hurt` 成功后发布非可取消的 Forge 服务端事件 `YssHitResolvedEvent`（拟新增名称）。事件发布必须早于“没有击退/击飞则 return”的分支，否则纯伤害段会漏报。
2. 事件携带攻击者、目标、modelId、animation、segmentIndex 和结算时目标包围盒中心。中心是音效位置近似，不宣称为精确刀刃接触点。必要时调整私有 applyHit 的参数传递，上游无 VFX 硬依赖。
3. VFX 的可选 YSS bridge 通过反射监听该事件，仅打包表现信息：服务端事件序号、维度、攻击者/目标 UUID、modelId、animation、segmentIndex、位置。通过 VFX 自己的 S2C 音效通道发送给同维度位置周围最多 64 格内的客户端；没有 YSS 时桥接器自动停用。
4. 客户端按自身加载的 hit_bindings 精确匹配，按音效 range 检查，再在服务器提供的位置播放一次。服务端不接受客户端 sound ID/任意路径，也不需要 OGG 文件；VFX 不判伤害、不重复算碰撞。
5. 命中消息带唯一事件序号，客户端以有界缓存去重；每个目标独立事件允许范围攻击多声重叠，总数仍由 voice 上限约束。同目标后续合法连击有新序号，不被永久抑制。维度不一致的消息丢弃，迟到消息由有限去重缓存抑制。

部署边界：单纯 Molang 音效只需客户端 VFX + YSM；权威命中联动还需要带上述事件的 YSS，以及服务端 VFX 的轻量事件/网络桥。专用服务器不加载客户端音频类，不要求安装 eyelib/YSM 渲染依赖，不持有音频数据。没有该扩展时施法音效仍可用，诊断显示“YSS 命中音效接口不可用”。禁止偷偷降级为客户端猜测命中。

VFX 对 YSS bridge 使用反射类加载隔离和事件方法名检查，不声明 YSS 编译依赖，也不依赖 YSS 私有包。YSS fork 的事件改动可单独提交上游；未安装带事件的 YSS 时，Molang 音效仍可用，命中绑定只是不触发。

## 7. 编辑器与调试入口

Blockbench VFX 插件的“资产与绑定”增加简洁的“音效”列表：导入 OGG、显示/修改逻辑名称、试听、音量/音高/范围/跟随、复制 play/stop Molang。沿用已有路径记忆、外部资产同步及同名冲突处理；正常文件不添加哈希后缀。

增加命中绑定行（YSS model ID、动画名、段下标、音效选择），保存到 audio.json。插件试听只验证声音内容，使用浏览器/Blockbench 音频播放，不保证与游戏三维衰减完全一致；自定义 Molang 不会因为 Blockbench 普通预览而自动执行。第一版不实现脚本解释器或完整动画音频预览。

reload 提示增加“特效数量 / 音效数量 / 命中绑定数量”。拟新增命令：

```text
/vfx_client sound play yesstevevfx:combat/slash test
/vfx_client sound stop test
```

音效 ID 自动补全；debug 记录命令接受、音效缺失、YSS 接口可用性、收到的命中 selector 和匹配结果，常态不逐帧打印。

## 8. 实施顺序与验收

1. **A：资源与后端**：包级 catalog、audio.json、纯音频包、虚拟资源包、reload/预算、手动命令。
2. **B：Molang 与插件**：两个 ctrl 函数、动作队列/槽位生命周期、OGG 导入/试听和一键复制；先交付可测试 JAR 与插件。
3. **C：YSS 命中**：与 YSS 作者对齐小事件接口，接即时/延迟路径、可选服务端桥和 S2C、插件命中绑定。必须包含专用服务器与双客户端验证。

完成标准：

- 无 eyelib 也能手动播放声音；纯音频包和旧视觉包均正确 reload。
- 中文路径、重名/缺文件、错误声道/编码、解码超预算有明确诊断；失败 reload 保留有效配置。
- 指令帧施法声正常；同槽叠加、不同槽叠加、不同玩家独立；观察性求值不响，允许动作的关键帧不重响。
- 第一/第三人称、低帧率跨帧、循环动画、暂停/恢复、世界切换、reload、设备重建不泄露声音实例。若 YSM 根本不求值指令帧，要如实记录宿主限制。
- 距离衰减、玩家/主音量滑块、follow 位置和自然结束均符合配置。
- YSS 空挥/拒绝/hurt false 不响，纯伤害段成功可响；延迟段在实际出伤时响且一次，多目标与后续连击正确。
- 命中重复消息、客户端缺资源、跨维度、未安装 VFX 的客户端不会引发崩溃或重复播放；专用服务器可启动。
- 测试包括资源解析、队列/槽位/会话清理、命中 selector/事件去重、即时与延迟结果分支，以及实际客户端听测。构建成功不代替听测通过。

本轮交付客户端音效测试构建、编辑器、示例包与 YSS fork 的事件桥接。当前服务端 VFX 通过反射监听 `YssHitResolvedEvent`，客户端按 `hit_bindings` 匹配并播放；未安装新 YSS 时桥接器自动停用。仍需在实际技能、多人和延迟出伤场景中验收，不把配置解析或构建成功当成游戏听测结论。
