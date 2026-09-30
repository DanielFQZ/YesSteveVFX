# YSM 内嵌 VFX 资源方案

这份方案保留两种资源来源：独立放在
`config/yesstevevfx/packs` 的 VFX 包，以及随 YSM 模型一起分发的 VFX
资源。两种来源在加载完成后都转换为同一个 `VfxAssetCatalog`，播放代码不
需要知道资源来自文件夹还是 YSM 容器。

## 目录和挂载方式

独立包继续使用现有布局：

```text
config/yesstevevfx/packs/<pack_id>/
  manifest.json
  effects/
  audio.json                 # 可选
  models/
  animations/
  particles/
  textures/
  entity/
  render_controllers/
  sounds/                    # 可选

旧包的 `assets/eyelib/` 和 `assets/yesstevevfx/` 目录仍然受支持。加载器
会把根目录分类映射到 eyelib 的内部资源快照，渲染后端无需改变。
```

YSM 模型包内使用固定的 `vfx/` 目录，不把 VFX 文件散落到 YSM 的模型、
动画和贴图目录：

```text
<ysm package>/
  ysm.json
  models/
  animations/
  textures/
  vfx/
    manifest.json
    effects/
    audio.json                # 可选
    models/
    animations/
    particles/
    textures/
    entity/
    render_controllers/
    sounds/                   # 可选
```

`vfx/manifest.json` 是 VFX 的边界。YSM 容器只需要把这个目录和其中的
字节交给 VFX，VFX 不直接读取 YSM 的私有索引、渲染对象或压缩实现。未来
YSM 的通用文件规范可以为这个目录增加一个显式文件入口；在此之前，固定
路径自动发现即可兼容已有模型包。

VFX 侧新增 `YsmVfxAssetSource`，实现 `VfxAssetSource`，流程与
`LocalVfxAssetSource` 相同：读取、校验、限制大小、生成不可变快照，成功
后一次性发布。YSM 容器没有 `vfx/manifest.json` 时不算错误，只表示该模
型没有内嵌 VFX。禁止让内嵌资源覆盖已经加载的独立包；同一 `pack_id` 出
现两次时 reload 失败并报告两个来源。

加载顺序固定为：

1. 独立 VFX 包；
2. YSM 容器内的 VFX 包；
3. 对同一包 ID 的冲突报错，不按扫描顺序静默覆盖。

这样独立包可以在开发阶段覆盖一个尚未发布的 YSM 内嵌包，但需要使用不同
的 `pack_id`；正式发布时应删除覆盖包，避免用户不知道实际生效的来源。

## 模型匹配键

模型绑定使用文件/文件夹相对路径作为机器键，不使用显示名称：

```text
独立包：<ysm_model_key> = YSM custom 根目录下的相对模型路径
内嵌包：<ysm_model_key> = YSM 容器根目录下的模型包相对路径
```

例如 `鸣潮_女漂 (1)` 可以作为当前模型键。比较前只做斜杠统一、Unicode
NFC 归一化和路径段校验，保留中文和原始大小写；不把 `metadata.name`
（例如“女漂”）当作唯一键。`metadata.name` 仍可作为界面显示名，方便作者
识别模型；将来 YSM 若提供稳定 UUID 或 Hash256，VFX 可以额外保存它作
为诊断信息，但不要求作者手填。

对于同一个 YSM 包内的多个模型，VFX 绑定使用：

```json
{
  "model_key": "鸣潮_女漂 (1)",
  "animations": ["attack_1"],
  "effect": "yesstevevfx:wuwa/slash"
}
```

`animations` 可以写 `"*"` 表示该模型的全部动画，也可以写名称数组。
明确列出的动画优先于通配规则；同一模型和动画出现两条不同绑定时直接报
错。模型文件名或目录名改变会产生新的键，编辑器应在导入时显示“旧键 →
新键”的迁移提示，而不是猜测并改写所有关系。

VFX 的 Molang 播放仍然是最明确的控制方式：

```molang
ctrl.vfx_play('wuwa:slash', 'skill_fx');
```

内嵌绑定只负责让资源和模型一起分发，以及为需要“指定模型 + 指定动画”
或“指定模型 + 全动画”的工具链提供声明；它不应该在没有 YSM 动作上下文
时自行扫描并播放特效。

## 指令帧与实际命中的分工

普通技能音效、挥刀声、攻击者身上的拖尾和蓄力特效都直接写在 YSM 动画的
指令帧中：

```molang
ctrl.vfx_play('wuwa:slash', 'attack_fx');
ctrl.vfx_sound_play('wuwa:swing', 'swing');
```

这些调用只表示动画已经播放到这一帧，不表示攻击命中了目标。空挥时它们
仍然应该播放，这正是动作表现的一部分，因此不需要模型名称或 YSS 模型
绑定。

只有“命中后才播放”的声音或目标特效才需要权威事件。YSS 在伤害处理成功
后发出事件，事件至少携带：

```text
attacker UUID, target UUID, target position, dimension,
animation, segment, sequence
```

VFX 根据 `animation + segment` 或一个明确的 `cue_id` 查找命中表现，在目标
位置创建粒子/模型实例。目标特效可以选择固定在命中位置，或者保存
`target UUID` 持续跟随目标。事件中可以继续保留内部 model key 供诊断和旧
版本兼容，但用户配置不必填写模型名称。

如果多个模型使用同名动画，不能仅靠动画名区分。优先使用 YSS 配置中的
`cue_id`，其次使用包级动画命名空间；模型键只作为最后的冲突消解字段，
不再作为每条音效和特效绑定的必填项。

YesSteveCamera 的索敌事件可以提供当前目标、方向或镜头 cue，但它不代替
YSS 的命中确认。Camera 触发的是“锁定/瞄准/镜头目标”表现，YSS 触发的
才是“实际伤害命中”表现；两者通过同一套带 `sequence` 的可选事件桥接，
VFX 不读取任一模组的内部对象。

## Molang 注册一次命中监测

命中表现不需要在音效表中预先绑定模型。动画指令帧可以注册一个短生命周
期的命中监测：

```molang
ctrl.vfx_hit_watch(
  'wuwa:attack_1_hit',
  'yesstevevfx:combat/hit',
  'yesstevevfx:wuwa/hit_burst',
  'attack_hit'
);
```

调用发生后，VFX 为当前 YSM 实体保存一条监测状态。之后收到 YSS 的确认命
中事件时，按 `cue_id` 或动画/判定段匹配音效和特效；音效可以来自当前包、
其它 VFX 包或 YSM 容器内的音频资源。命中特效默认生成在目标位置，也可以
配置为继续跟随目标。

监测状态不需要绑定 YSM 的 `AnimationPlayer` 生命周期。指令帧只负责“武装”
一条有限生命周期的命中规则；YSS 的确认命中事件到达后，VFX 依据动画名、
判定段和 cue 进行匹配。规则可以配置为命中一次后消费，也可以允许同一轮
攻击响应多个目标。没有命中时，规则在有限的攻击窗口后自动过期，防止迟到
事件误触发下一轮攻击。

因此 YSM 不需要新增停止帧或动画生命周期接口。YSM 接口未来最多只能提供
更精确的播放实例 token，用于处理同一个动画快速重播的边界，不是当前方案
的前置依赖；命中信息仍然完全由 YSS 提供。

命中特效本身也不随动画结束自动停止。模型实例使用 effect 的
`duration_ticks`，粒子使用自身寿命，声音使用自身音频长度。这样一段连招
的第一段结束后，第一段的法术特效仍可继续播放，第二段不会因为动画切换
而强制清理它。

视觉播放 slot 仍按实例分组：当前同一实体同一 slot 的 `vfx_play` 会替换
旧实例。因此需要连续叠加的连段应使用不同 slot，例如 `spell_1`、`spell_2`
或每次生成唯一的实例 slot；也可以在后续增加显式的 `vfx_spawn` 叠加接口。
命中监测 slot 只用于管理规则，不应默认复用视觉实例 slot。

YSS 事件还应包含攻击实例序号或等价的执行代次。只使用动画名和一个网络
消息序号，无法区分同一实体快速连续重播同一个动画时的迟到命中。客户端
按“攻击者 UUID + playback token/cue + attack instance + hit sequence”去
重放，收到事件的时间晚于动画结束时仍可以判断它是否属于已经结束的这一轮。

这种机制的边界是：Molang 负责选择“这一轮攻击命中时用什么表现”，YSS 负责
证明“确实命中了谁”。它不要求用户填写 YSM 模型名称，也不把命中判断下放
到客户端。

这里的 `slot` 是监测状态的分组名，不是音效 ID，也不是模型名称。视觉特效
slot、普通音效 slot 和命中监测 slot 应保持独立；例如 `main` 可以放常驻
光环，`skill` 放攻击特效，`attack_hit` 放这一轮命中监测。

## 音效和未来 YSS 配置

`audio.json` 可以放在独立包或 YSM 的 `vfx/` 中，格式保持一致。命中配置
的模型字段改为 `model_key`，与上面的相对文件/文件夹键一致；`model_name`
只作为编辑器缓存的显示标签，运行时匹配不依赖它。这样音效包、粒子/模型
特效和未来 YSS 配置都能随同一个 YSM 模型发布，而不要求作者手动复制一
套目录名。

当前 VFX 音频后端继续使用 `ctrl.vfx_sound_play` 和
`ctrl.vfx_sound_stop`，不接管 YSM 的 `SoundInstance` 生命周期。未来
EmpyreanSoundMix 只需要实现 VFX 的 `AudioBackend` 适配器，保留 sound ID、
播放句柄、停止和跟随语义；这样不会依赖 YSM 的 mixin，也不会破坏重混音。

## YSS 与 YesSteveCamera 的通信边界

VFX 不直接依赖 YSS 或 Camera 的内部类。三者之间应使用可选的事件桥，事
件只携带表现层数据：

```text
source UUID, model_key, animation, event/segment, dimension,
sequence, position, optional direction/target
```

- YSS 提供确认命中事件；VFX 将它转换为音效或特效触发请求。
- YesSteveCamera 提供镜头 cue 事件；VFX 可以在同一 sequence 上播放特效，
  但不读取 Camera 的内部轨道对象。
- VFX 的 Molang 接口仍然可以独立工作；没有 YSS 或 Camera 时不影响普通
  播放。

事件中的 `model_key` 采用 YSM 文件/文件夹键，`metadata.name` 只用于日志
和编辑器界面。事件必须带有限序号，客户端按“来源 UUID + sequence”做有
界限去重，避免命中事件或镜头事件重复播放。

## 编辑器工作流

Blockbench 插件提供两个导出目标：

- **独立 VFX 包**：写入 `config/yesstevevfx/packs/<pack_id>`；
- **写入 YSM 包的 vfx 目录**：选择 YSM 包目录后写入 `vfx/`，不修改 YSM
  的模型和动画文件。

导入 YSM 包时，插件先读取 `ysm.json` 的元数据和模型路径，再读取
`vfx/manifest.json`。界面显示“女漂（键：鸣潮_女漂 (1)）”，绑定和导出
始终保存键。若 VFX 资产仍在独立目录，插件可以生成相同的绑定声明，让作
者在确认后迁移到 YSM 包内。

所有来源继续使用相同的资源大小、相对路径、JSON 字段和 reload 校验；这
样可以先实现文件夹版和 Blockbench 工作流，等 YSM 通用容器公开稳定接口
后只需替换 `YsmVfxAssetSource`，不需要重写渲染和音频后端。
