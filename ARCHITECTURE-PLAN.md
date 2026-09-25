# YesSteveVFX 1.20.1 架构方案

## 判断

可以基于 \`E:\JavaProject\YesSteveModel\YesSteveModel-dev-1.20\` 开发，但 YesSteveVFX 不应直接复制 YSM 的私有动画/渲染实现，也不应把 VFX 逻辑塞进 YSM 的模型 renderer。建议把 YSM 当作：

- Molang 解析和执行宿主；
- 动画指令帧的触发宿主；
- 统一资产容器的提供方；
- 可选的实体/骨骼锚点查询方。 

对 VFX 本身，可以进一步把渲染责任完全交给 eyelib：YSM 不参与 VFX 的 geometry、材质、Bedrock animation、controller 或粒子绘制。YSM 只负责动画指令/Molang 控制，以及在存在稳定公共接口时提供经过验证的资产容器或资源视图。YSM 自己的玩家模型渲染是否启用，是另一个独立问题。

eyelib 当前仍是实体驱动的渲染管线，因此“eyelib 独立渲染”不等于“无需实体”。第一版仍应为每个完整特效创建一个 `LivingEntity` carrier，把 `BrClientEntity` 通过 `RenderData.ClientEntityComponent.setClientEntity(...)` 绑定到 carrier；eyelib 的 `EntityRenderOrchestrator`、`BrAnimator` 和粒子后端负责后续求值与绘制。若将来要去掉 carrier，必须由 eyelib 提供稳定的 detached render entry，而不是从 YSM renderer 借用内部对象。

需要区分“YSM 不绘制 VFX”和“YSM 完全不运行自己的动画求值”。当前 YSM 的 instruction keyframe 是在动画 processor 的求值流程中执行，而该流程主要由模型渲染路径推进；现有 `RenderModelEvent` 可以在模型提交前取消默认模型绘制，但文档没有承诺一个独立于渲染的控制 tick。第一版可以让 YSM 继续求值、取消它的模型提交，只让 eyelib 产生画面。若要求 YSM 连动画求值都不运行却仍保留 instruction keyframe 控制，则需要 YSM 新增独立 control-tick/API，或改用 YesSteveVFX 自己的命令/网络入口。

YesSteveVFX 自己拥有特效定义、特效实例、生命周期、资源适配和渲染调度；具体 Bedrock 模型与粒子绘制交给 eyelib。这样 YSM 没安装时 VFX 仍可加载本地特效和测试命令；YSM 安装时才启用 Molang 和动画指令联动。

早期深度场景原型已经从运行时代码、命令和网络协议中移除；其历史提交仍可通过 Git 查看。当前实现只保留模型、动画和粒子 VFX 运行时。

## 推荐分层

~~~text
YesSteveVFX
├─ vfx-core
│  ├─ EffectDefinition / EffectInstance / EffectRegistry
│  ├─ VfxAssetStore / VfxAssetCatalog
│  ├─ Bedrock、Image/GIF、Tail、glTF、Geo、Light、Sound 数据模型
│  └─ VfxApi（play/stop/update）
├─ vfx-forge
│  ├─ Forge 1.20.1 入口、命令、ClientTick、RenderLevelStageEvent
│  ├─ 资源 reload、纹理/GPU 资源所有权
│  └─ EffectRenderDispatcher
├─ vfx-ysm-bridge（可选）
│  ├─ YSM Molang binding 注册
│  ├─ YSM instruction/event 到 VfxCommand 的适配
│  └─ Entity/Bone anchor 查询
└─ ysm-asset-format（共用格式 API，最终放入 YSM 公共 API 或单独小库）
   ├─ AssetContainerReader/Writer
   ├─ manifest、chunk、hash、zstd 验证
   └─ VfxManifest/VfxAssetFileView
~~~

当前单模块工程也可以先按 package 分层，等接口稳定后再拆 Gradle 子项目。YSM 的依赖应使用 \`compileOnly\` 的 API/JAR，不能把完整 YSM、GeckoLib 或 native 库打进 VFX JAR。

技术 ID 建议在首次发布前固定为 \`yesstevevfx\`，配置目录和资源 namespace 统一使用它：

~~~text
config/yesstevevfx/
yesstevevfx:<pack>/<asset>
~~~

当前骨架使用 \`yesstevevfx\`。因为它还没有稳定发行版，建议现在改名；如果必须保留现有兼容性，则保留 \`yesstevevfx\` 作为 Forge modId，只把显示名改为 YesSteveVFX，不能同时让两个 namespace 代表同一套资源。

## 本地文件布局

VFX 资源直接放在客户端：

~~~text
config/yesstevevfx/
├─ settings.toml
├─ packs/
│  ├─ default/
│  │  ├─ manifest.json
│  │  └─ effects/
│  │     └─ fire_slash/
│  │        ├─ effect.json
│  │        ├─ particles/
│  │        ├─ images/
│  │        ├─ models/
│  │        ├─ sounds/
│  │        └─ shaders/
│  └─ custom.ysm
└─ cache/
~~~

开发期 \`effect.json\` 方便阅读；运行时解析成不可变的 \`EffectDefinition\`。资源引用只允许清单中的相对路径，不能直接把网络字符串当作本地路径。

一次加载产生一个 \`AssetGeneration\`：

1. 扫描并规范化路径。
2. 读取清单，检查 schema、数量、大小和 hash。
3. 后台解析 JSON、图像、Bedrock/Molang、glTF。
4. 在客户端线程上传纹理和 GPU buffer。
5. 通过原子替换发布新 generation。
6. 旧 generation 等所有实例释放后再关闭资源。

不要在每个 tick 扫描目录，也不要把 VFX 文件复制到 \`.minecraft/assets\` 或通过 ResourceManager Mixin 伪装成 vanilla 资源。

## 与 YSM 通用文件格式的衔接

YSM 当前已经有 Asset Container、chunk、Manifest、BLAKE3 身份和 zstd/压缩验证。VFX 应复用这套容器层，但使用独立 schema，例如：

~~~text
schema = yessteve.vfx
chunks:
  verification
  manifest
  effect/<namespace>/<id>
  blob/<content-id>
~~~

VFX 不应把自定义 chunk 直接塞进普通 YSM 模型 Manifest。当前模型 schema 要求模型 Manifest、render target 和引用闭包；向其中添加 VFX 私有 payload 会破坏 schema 验证边界。正确做法是使用同一个通用 Asset Container 编码，新增 \`VfxManifest\` 和 \`VfxAssetFileView\`，使 YSM 和 VFX 都能读共享的 container header/chunk/hash/压缩规则。

\`VfxManifest\` 至少包含：

~~~text
format_version
pack_id
display_name
effects { effect_id, config_chunk, feature_flags }
assets { path, media_type, blob_id, stored_size, decoded_size, hash }
dependencies { id, min_version, max_version }
~~~

YSM 负责提供通用容器读写 API；VFX 只消费经过验证的 \`VfxAssetFileView\`。如果近期不方便拆出公共 JAR，可以先在 YSM 增加一个稳定的只读格式 API，再让 VFX \`compileOnly\` 依赖它；不要在两个工程里复制两套容器解析器。

以后 YSM 导出模型时，可以在同一用户工作流中附带 VFX 包，但模型容器和 VFX 容器仍保持两个 schema。VFX 加载器只认 \`yessteve.vfx\`，YSM 模型加载器只认模型 schema。

## EffectDefinition 与运行实例

定义和实例必须分开：

~~~text
EffectDefinition（共享、只读）
  id, version, feature flags, resources, emitters, transforms, expressions, budgets

EffectInstance（每次播放独立）
  instanceId, sourceEntityUuid, slot, generation,
  startTick, age, duration, seed,
  anchor, transform, parameters, child runtimes
~~~

实例 key 建议是 \`sourceEntityUuid + slot\`。同一个 YSM 实体在同一个 slot 重播时，采用显式策略：restart、replace 或 ignore；不要依赖遍历列表猜测要停止哪个对象。

特效不必一开始注册为 Minecraft \`Entity\`。第一阶段使用客户端逻辑实体 \`VfxInstance\`，由 \`VfxWorldState\` 管理和渲染；它可以附着到真实 Entity UUID、世界坐标或以后加入的 YSM bone anchor。这样不会引入服务端实体同步、碰撞和存档负担。

实例生命周期：

~~~text
create -> running -> stopping -> stopped
                         └─ resource/entity missing -> expired
~~~

目标实体丢失时保留有限 grace ticks，超过预算自动停止；世界切换、资源 generation 切换、断开连接和 YSM 模型清理都必须停止或迁移相关实例。

## YSM Molang 联动

YSM 现有代码已经提供适合的基础：

- \`PrimaryBinding\` 在解析期注册根 binding；
- \`ContextBinding.function(...)\` 注册函数；
- \`IContext.entity()\`、\`level()\`、\`animationEvent()\` 提供目标上下文；
- \`IContext.allowEmitting()\` 区分动作阶段和观察阶段；
- instruction keyframe、on-entry、on-exit 通过动作阶段执行；
- YSM 规定指令帧必须按主时间线经过的区间执行，不能只看最终采样点。

不要让 VFX 通过反射修改私有 \`YSMBinding\`。先在 YSM 增加一个很小的公共扩展接口，在所有模型加载前完成注册：

~~~java
public interface YsmMolangBindingContributor {
    void register(ContextBinding root);
}
~~~

更稳妥的形式是由 YSM 发布 \`YsmMolangBindingRegistrationEvent\`，VFX bridge 在 client setup 期间注册一个 \`vfx\` 子 binding。事件或注册器必须在 parser 创建前锁定；YSM 文档已经说明 binding 名称在解析期绑定，之后再注册不会影响已解析 AST。

建议初版函数：

~~~text
vfx.play(effect_id, slot)
vfx.play_at(effect_id, slot, x, y, z)
vfx.attach(effect_id, slot, bone_name)
vfx.stop(slot)
vfx.stop_all()
vfx.set(slot, parameter_name, value)
vfx.exists(slot)
~~~

函数返回有限数值：成功/排队为 \`1\`，拒绝/不在动作阶段为 \`0\`。slot 是字符串，作用域是当前 YSM entity；effect id 使用 \`namespace:path\`。初版不要让 Molang 直接传 JSON 或任意路径。

函数执行规则：

1. 首先检查 \`context.allowEmitting()\`。观察性 render pass、查询和重复计算不得产生特效。
2. 读取 \`context.entity()\` 的 UUID、世界和当前动画 frame。
3. 生成不可变 \`VfxCommand\`，带 source entity、frame id、顺序号和 generation。
4. 追加到 VFX command buffer；不要在 Molang evaluator 内直接改变渲染列表。
5. 在同一客户端 tick 的动画动作阶段结束后一次性应用 command。
6. 用 frame id + sequence 去重，保证一个指令帧不会因多次 render observation 重复播放。

推荐调用示例：

~~~text
vfx.play("yesstevevfx:fire_slash", "attack_fx");
vfx.set("attack_fx", "power", v.attack_power);
vfx.stop("attack_fx");
~~~

返回值只表示命令是否被接受，不表示 GPU 资源已经上传完成。特效是否完成加载由本地 registry 决定。

### 骨骼锚点

第一阶段只支持 entity root、头部/手部等可由实体姿态计算的锚点。完整骨骼附着需要 YSM 增加公开的只读 bone pose seam，例如：

~~~text
YsmBonePoseView {
  entity_uuid
  frame_id
  bone_name
  position
  rotation
  scale
}
~~~

YSM 在动画 processor 完成当前帧骨骼输出后发布该快照；VFX renderer 根据同一 frame id 解析 \`vfx.attach(..., bone_name)\`。VFX 不应访问 YSM 私有 renderer、native buffer 或内部 \`GeoModel\`。如果 bone API 尚未完成，attach 仍可保存 bone name，并回退到 entity root，同时记录一次诊断。

## 渲染实现顺序

建议按风险和复用价值分阶段：

1. **MVP**：EffectDefinition/EffectInstance、carrier entity 路线、Bedrock 模型静态渲染、模型纹理、统一 effect clock、play/stop/update。
2. **Bedrock 动画**：geometry 骨骼、animation timeline、controller、Molang bone 动画、locator pose 和模型材质；先通过 carrier entity 接入 eyelib 的现有实体管线。
3. **Bedrock 粒子**：JSON scheme、Molang 曲线、emitter、billboard、tint、collision，并接入同一 effect clock 和 carrier 生命周期。
4. **图片/GIF、尾迹、声音**：作为独立 layer，但与模型/粒子共享实例生命周期和资源 generation。
5. **glTF/GeckoLib**：通过独立 adapter 加入，不能把它们的资源格式强行转换成 Bedrock geometry。
6. **天空、灯光、shader、投射物 renderer**：作为可停止 layer，不和普通粒子共享全局状态。

1.20.1 渲染入口使用 Forge 的 \`RenderLevelStageEvent\`、\`PoseStack\`、\`MultiBufferSource\`、\`VertexConsumer\` 和明确的 \`RenderType\`。更新使用 \`ClientTickEvent\`。解压、图片解码、JSON/glTF 解析在后台；纹理和 GPU buffer 创建/释放回到客户端线程。

建议的 dispatcher 顺序：

~~~text
VfxWorldState snapshot
  -> anchor/transform update
  -> image/tail pass
  -> bedrock particle pass
  -> model pass
  -> light/sky/shader layer
  -> sound queue
~~~

所有 pass 消费同一帧的不可变 snapshot，不在渲染时修改实例 map。

## 网络边界

YSM 动画驱动的本地特效不需要为每个播放发送网络包。远端实体是否播放由远端客户端自己的 YSM 动画和动作门禁决定；需要服务器权威或跨客户端一致性时，再增加受限的 VFX action 消息：

~~~text
VfxStart { instance_id, source_entity, effect_id, slot, start_tick, transform, parameters }
VfxUpdate { instance_id, server_tick, transform_delta, parameters }
VfxStop { instance_id, reason }
~~~

消息应接入 YSM 现有有界协议原则，使用显式字段、长度、目标授权和资源 hash。不要复刻旧 JE 的 Java ObjectInputStream/Map 反序列化。网络只传 effect id 和参数，资源仍由客户端已验证的 local/YSM asset catalog 提供。

## 预算与安全

至少在 \`VfxLimits\` 集中设置：

~~~text
max_active_instances_per_entity
max_particles_spawned_per_tick
max_effect_lifetime_ticks
max_asset_bytes
max_texture_pixels
max_gltf_vertices
max_bedrock_emitters
max_molang_source_length
max_molang_commands_per_frame
~~~

所有路径 canonicalize 后再打开；拒绝绝对路径、盘符、\`..\` 和符号链接越界。远程 URL 不作为初版协议能力；若未来加入，只允许 HTTPS 白名单并限制响应大小、重定向、超时和图片解码像素数。

Molang effect function 必须始终经过 \`allowEmitting\`，并限制函数参数数量、字符串长度和每帧 command 数量。资源 generation 替换时旧实例不可继续引用已关闭的 texture/buffer。

## 实施顺序

1. 已在 YesSteveVFX 完成 \`VfxAssetSource\`、\`EffectDefinition\`、\`EffectAssetBundle\`、\`VfxClientRuntime\`、\`VfxApi\` 和本地资源 reload/play MVP。
2. 在 YSM 增加只读的 Molang binding contributor/event；先只支持 \`vfx.play/stop/set/exists\`，用 entity root 锚点。
3. 把 YSM 通用 Asset Container 提取成稳定只读 API，VFX 增加 \`yessteve.vfx\` schema reader；本地目录和 \`.ysm\` 容器都转成同一 \`EffectAssetBundle\`。
4. 加入 Bedrock/Molang emitter 和尾迹，补充 frame/command 去重测试。
5. 加入 glTF，随后设计 YSM bone pose seam。
6. 最后再实现 GeckoLib、天空、灯光、shader、投射物 renderer 和可选网络 action。

每阶段的验收样例应包含：

- 同一 instruction keyframe 循环一次只播放一次；
- observation/render 重算不重复播放；
- \`allowEmitting=false\` 时函数返回 0 且没有实例；
- stop/restart/replace 对同一 slot 的行为固定；
- reload 后旧 generation 不再被渲染；
- entity、world、bone 三种 anchor 在 partial tick 下位置连续；
- 资源路径、大小、hash 和 Molang 长度超过限制时拒绝加载。

## 最终建议

YesSteveVFX 可以在 YSM 项目支持下开发，且这是实现 YSM 动画控制特效的合适路径。关键决策是把 YSM 的职责限制为 Molang/动画/格式 API，把 VFX 的实例和渲染留在 YesSteveVFX；先定义公共 binding 和公共资产容器，再开始批量移植旧 JE 功能。这样旧 JE 的 Bedrock、图片、尾迹、glTF 和模型链可以逐步迁移，同时不会把 YSM 的私有 renderer 和 VFX 的生命周期绑死。


## Eyelib 复用评估

`E:\JavaProject\YesSteveModel\eyelib-master` 很适合作为 YesSteveVFX 的 Bedrock/Snowstorm 粒子后端。它已经包含以下完整链路：

- `particle.runtime.bedrock`：发射器、粒子实例、寿命、Molang 曲线、局部空间和随机状态；
- `particle.runtime.bedrock.component`：instant/manual/steady 发射率、once/looping 生命周期、point/box/sphere/disc/custom/entity AABB 形状、billboard、flipbook、lighting、tint、initial speed/spin、dynamic/parametric motion、kill plane 和方块过期条件；
- `ParticleRenderManager`：发射器和粒子列表、客户端 tick、渲染 tick、移除和登出清理；
- `BedrockParticleRenderer` 与 `ParticleRenderHooks`：Forge 1.20.1 `RenderLevelStageEvent.AFTER_ENTITIES` 渲染接入；
- `ParticleResourcePublication`：Bedrock 粒子 JSON 的 Codec 解析、按来源暂存以及原子替换注册表；
- `ParticleSpawnRuntimeAdapter`：字符串粒子 ID 的生成、位姿更新和移除；
- `BrAnimationEntryDefinition`：Bedrock `particle_effects` 关键帧、locator 位姿和 `AnimationParticleSpawner` 接口。

因此，第一版不应复制旧 JE 的 `BedrockEmitter`。YesSteveVFX 只需实现 `EyelibParticleBackend`，把自己的 `VfxInstance` 映射为 eyelib 的 `spawnId + particleId + pose`，把图片/GIF、尾迹、glTF、天空和 shader 留在自己的渲染层。

### Bedrock 模型和动画是同一个特效的一等组成部分

旧 JE 的高级效果不是“粒子播放后再额外挂一个模型”，而是一个效果定义同时拥有 Bedrock 模型、纹理、动画和粒子发射器，并由同一个实例时钟、锚点和参数驱动。YesSteveVFX 的核心对象应改为组合实例：

```text
EffectDefinition
  model: BedrockModelDefinition
  animations: AnimationSet / AnimationControllerSet
  particleEmitters: [ParticleDefinitionRef]
  timeline: EffectTrack[]
  anchors, parameters, resources

EffectInstance
  modelInstance: BedrockModelInstance
  particleInstances: [ParticleInstance]
  effectClock, transform, parameters, state
```

模型运行时需要负责：

- Bedrock geometry 骨骼树、pivot、旋转、缩放和 locator；
- animation 文件中的 bone timeline、插值、loop、blend 和 controller 状态；
- 模型内 Molang 上下文，以及与特效参数和目标实体的绑定；
- 模型纹理、透明/发光材质和 RenderType；
- 将模型根节点或指定 locator 的 pose 提供给粒子 emitter。

YSM 可以复用当前的 Bedrock geometry、animation 解析和 bake/cache 代码，但不要直接把 VFX 当成玩家模型塞入 YSM 的 player renderer。应让 YSM 提供一个公开的、与实体无关的只读/渲染 seam，例如 `BedrockModelAsset`、`BedrockAnimationAsset`、`BedrockModelInstance` 和 `BedrockPoseSnapshot`；YesSteveVFX 负责创建独立模型实例、推进 effect clock 和销毁实例。若这些 seam 尚未稳定，第一阶段可在 VFX 内复制最小的模型实例层，同时复用 YSM 的格式解析和资源容器。

eyelib 本身已经具备 Bedrock 模型、ClientEntity、render controller、Molang 动画和实体渲染编排：`BrClientEntityLoader`/`ClientEntityManager` 管理 Bedrock client entity，`ClientEntityRuntimeData` 将 geometry 解析为模型，`BrAnimator` 推进动画，`EntityRenderOrchestrator` 在实体渲染阶段组装模型和 render controller。DeepWiki 的架构页也明确把这条链描述为“用 Bedrock 模型和动画替换实体的原版渲染”，并把 `RenderData` 列为实体上的中心状态（scope、ModelComponent、AnimationComponent、ClientEntityComponent）。因此它可以承担 Bedrock 模型动画渲染，但当前入口是“挂到 `LivingEntity` 上的实体渲染管线”，不是开箱即用的 detached model player。

如果 YSM 暂时不适合开放 detached seam，第一版可以采用 **carrier entity**：为每个完整特效实例创建一个无碰撞、无重力、不可见的 `LivingEntity` 载体，把 Bedrock client entity/model/animation 绑定到该载体；YesSteveVFX 维护特效 ID、生命周期和资源引用，eyelib 负责载体的模型动画与渲染，eyelib 粒子通过同一个载体或 locator 更新。载体可以是服务端同步的 NPC，也可以是仅客户端的假实体；多人同步优先使用服务端 NPC，单机/本地 YSM 指令优先使用客户端假实体。

载体策略的边界：

- 最简单可靠的粒度是“一份完整特效对应一个载体实体”，不要第一版在一个载体上复用多个独立动画状态。
- 服务端 NPC 负责位置、朝向、存在时间和可见范围；客户端资源决定它实际显示的 Bedrock 模型与动画。
- 载体必须关闭碰撞、重力、AI、阴影和原版可见模型；若使用盔甲架 marker 或专用无碰撞 LivingEntity，要确认该实体能进入 eyelib 的 `LivingEntity` 渲染入口。
- effectId、资源版本和模型选择不要依赖实体名称猜测，使用自定义 payload、同步数据或受限 tag 明确传递。
- 载体消失、换世界、断线或资源 reload 时，YesSteveVFX 必须同时销毁对应的模型/粒子实例。

载体实体和特效实例仍是两个概念：实体是 Minecraft 世界中的同步锚点和 eyelib 的宿主；特效实例是 YesSteveVFX 的组合状态（模型动画时间、粒子、参数、资源 generation）。一个载体可以在将来承载多个 slot，但 MVP 建议一对一，便于停止、回收和网络同步。

### Eyelib 载体接入的具体落地

eyelib 的 Bedrock 模型资源不是只注册一个 geometry 文件就能显示。载体的实体类型 ID 必须能解析到一个 `BrClientEntity`，而该定义还要引用 geometry、texture/material、animation/controller 和 render_controller。VFX 资源加载器需要把 `config/yesstevevfx` 的内容解析后，按唯一 ID 发布到 eyelib 相应 registry；不能直接调用 `ClientEntityManager.replaceAll` 清掉 YSM/其他 addon 的实体，应该使用合并发布或只写入自己命名空间的条目。当前源码的 `ClientEntityComponent.setClientEntity(...)` 允许为某一个载体直接绑定解析好的 `BrClientEntity`，这是实现“同一种载体实体承载不同特效”的可用接入点，但应由 `EyelibCarrierBackend` 集中调用。

服务端同步载体的推荐形态是一个专用的无碰撞 `VfxCarrierEntity`；兼容旧 NPC 方案时也可以使用 marker armor stand 或 NPC 插件提供的 `LivingEntity`。载体需要关闭碰撞、重力、AI、阴影、名称牌和原版可见模型，并同步 effectId/resource generation/播放状态。eyelib 当前 `EntityRenderOrchestrator` 主要遍历客户端世界中的实体并对 `LivingEntity` 取 `RenderData`，所以载体类型必须经过该入口；只有普通 `Entity` 的载体不能假定能直接套用当前模型管线。

第一版建议“一份完整特效一个载体”：服务端或客户端创建载体，YesSteveVFX 按载体 UUID 建立 `EffectInstance`，eyelib 通过载体的 `RenderData` 驱动 Bedrock 模型动画，`EyelibParticleBackend` 用相同 UUID 管理粒子。载体移动、消失、换世界和 reload 都作为统一的实例生命周期事件处理。等模型和粒子组合稳定后，再考虑一个载体承载多个 slot。

### 是否必须修改 eyelib 或 YSM

采用 carrier entity 路线时，YesSteveVFX 可以先不修改 eyelib 和 YSM 的源码，直接把它们作为运行时依赖。eyelib 已有模型/动画实体管线，YSM 已有带 `allowEmitting` 的指令帧 Molang 执行。源码层面，`ContextBinding.function(...)` 是 public，且 `CtrlBinding.INSTANCE` 可取得，因此实验版本可以在 parser 创建前注册 `ctrl.vfx_play(...)`、`ctrl.vfx_stop(...)` 等函数。这是利用当前实现细节的兼容层，不是 YSM 文档承诺的稳定第三方扩展 API；必须在 VFX 中做版本检测、失败降级和启动诊断。

若必须使用全新的根命名空间 `vfx.play(...)`，当前 YSM 的固定 extra binding 没有文档承诺的第三方注册入口，仍需要 YSM 增加 binding contributor/registration event，或使用不推荐的反射。YSM 文档还明确指出，binding 名称在解析期固定，已经解析的 AST 不会因为之后注册而改变，所以注册时机必须早于模型/动画解析。

因此，“不改两个 Mod”可以完成 carrier 版 MVP 和主要运行时，但前提是接受 `ctrl.vfx_*` 这个实验性兼容入口，且由 YesSteveVFX 自己实现载体实体、配置目录加载、eyelib 资源注册、`RenderData` 绑定、函数去重/动作阶段门禁、实例回收和自己的非 Bedrock layer。若目标是 detached 模型、稳定的根命名空间 `vfx.*`、跨版本 Molang 扩展或 YSM 私有骨骼 pose，则不能把“不修改 YSM”当作长期方案。

YSM 文档中的 `@YsmExtension` / `@YsmEventHandler` 只负责兼容检查和事件装载；`RegisterRenderStateModifierEvent` 当前没有完整生产接线，`future/mod-animation-integration.md` 也仍属于规划边界。因而 VFX 不应把这些表面当作已经存在的 detached-model 或 Molang contributor API。

模型和粒子必须在同一帧使用同一个 effect clock：

```text
effect tick / partial tick
  -> evaluate model animation
  -> evaluate model locator poses
  -> update effect root and bone attachments
  -> tick eyelib particle emitters
  -> render model and particles with one snapshot
```

粒子 locator、模型 locator 和 `vfx.attach(..., bone)` 都引用同一份 `BedrockPoseSnapshot`。这样模型刀光、模型动画和粒子喷发不会因为分别取客户端时间而产生一帧偏移。

### 当前源码的接入方式

在 eyelib 当前源码中，最小可行接入点是：

```java
ParticleResourcePublication.replaceFromJsonResources(
        "yesstevevfx",
        particleJsonBySourceId,
        logger);

ParticlePort.getSpawnAdapter().spawn(
        new ParticleSpawnRequest(spawnId, particleId, position));
ParticlePort.getSpawnAdapter().updatePose(spawnId, pose);
ParticlePort.getSpawnAdapter().remove(spawnId);
```

资源加载器仍应由 YesSteveVFX 自己实现：eyelib 自带的 `BrParticleLoader` 只扫描 `assets/eyelib/particles/*.json`，不会扫描 `config/yesstevevfx`。VFX 加载器可以在后台扫描配置目录，解析完成后在客户端线程调用 `replaceFromJsonResources`；图片可以先解码为 `ImportedImageData`，再通过 eyelib 的纹理注册/上传入口发布。粒子 JSON 的 `description.basic_render_parameters.texture` 应使用稳定的 `yesstevevfx:<相对纹理路径>` 形式，并由资源层建立同名纹理映射。

### 必须保留的边界

eyelib 的粒子 API 不能直接代替 VFX 的实例层。当前 `ParticleSpawnRequest` 没有目标实体、世界、参数或 generation 字段，默认 `MinecraftParticleRuntimeEnvironment` 的实体 AABB 取本地玩家；远端玩家、投射物和骨骼附着需要由 VFX 自己维护位姿，或者由 eyelib 增加带上下文的 spawn Port。VFX 不应依赖 `ParticleRuntimeBridge` 中的 singleton 细节作为长期公共契约。

当前组件表里 `particle_lifetime_events`、`emitter_lifetime_events` 和 `particle_motion_collision` 主要完成了 schema 解码，源码中没有对应的运行时回调；需要旧 JE 的碰撞、事件链或 morph 行为时仍要在 eyelib 中补实现，或在 VFX backend 外加适配层。eyelib 也不包含旧 JE 的图片/GIF、尾迹、glTF 或 GeckoLib 特效运行时。

### 版本和构建风险

README 中的 Maven 坐标 `io.github.tt432:eyelib:21.1.14+1.20.1-forge` 对应的是已发布的旧包。该包的粒子类名位于 `io.github.tt432.eyelibparticle.*`，而当前源码使用 `io.github.tt432.eyelib.*`；已发布的 `ParticleSpawnApi` 还没有当前源码中的 `updatePose`，`ParticleResourcePublication` 也没有 `sourceKey` 参数。因此不能把 Maven Central 构件当作当前源码的二进制 API。

接入应二选一：

1. 固定 eyelib 源码版本，由朋友先发布一个带稳定公共 Port 的 1.20.1 Forge 构件，再在 YesSteveVFX 中声明必需的客户端依赖；
2. 在 YesSteveVFX 的开发环境中使用 eyelib 本地构建/本地 Maven 仓库，并把具体版本和源码提交固定下来。

我用现有 Windows 环境尝试编译当前 eyelib 源码，构建在 Stonecutter/Gradle 的 `JvmVendorSpec.IBM_SEMERU` 配置阶段失败，尚未进入 Java 编译；这属于构建环境/插件兼容问题，不能作为源码可编译的证明。接入前要先解决该构建闸门。

### 推荐的最终依赖形态

当前采用“直接使用 eyelib 现有接口、在 VFX 内部隔离”的方案。YesSteveVFX 固定 eyelib 的源码提交或 Maven 构件版本，在自己的代码中增加 `EyelibParticleBackend`，让 `ParticlePort.getSpawnAdapter()`、`ParticleSpawnApi` 和 `ParticleResourcePublication` 只出现在这一层。后续 eyelib 改包名或替换实现时，只需要修改该适配层。

适配层承担以下操作：

```text
replaceFromJsonResources(sourceKey, resources)
spawn(spawnId, particleId, position)
updatePose(spawnId, pose)
remove(spawnId)
```

`ownerId -> spawnId` 的批量清理、资源 generation、实体/骨骼锚点和 VFX 实例状态由 YesSteveVFX 自己维护。第一版通过 `updatePose` 提供世界位姿；不把 eyelib 的 renderer、Molang singleton 或私有 manager 暴露到 VFX 其他模块。这样 YSM 的 Molang/指令帧负责发出 `vfx.*` 命令，YesSteveVFX 负责实例生命周期，eyelib 负责 Bedrock 粒子求值和绘制。

