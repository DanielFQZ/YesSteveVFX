# YSM Molang 控制规范

这份文档说明 YesSteveVFX 测试版本提供给 YSM 的 `ctrl.vfx_*` 函数。它们由客户端可选 bridge 注册；没有 YSM 时，YesSteveVFX 仍然可以使用 `/vfx_client` 命令播放特效。

## 在 Blockbench 中添加指令帧

在 YSM 动画编辑器中选择目标动画，在“动画效果”里添加“指令”关键帧。指令内容就是一段 Molang 表达式，例如：

```molang
ctrl.vfx_play('yesstevevfx:demo', 'main');
```

Blockbench 导出的动画 JSON 应包含 `timeline`：

```json
{
  "animations": {
    "attack_1": {
      "animation_length": 1.0,
      "loop": false,
      "timeline": {
        "0.0": "ctrl.vfx_play('yesstevevfx:demo', 'main');",
        "0.25": "ctrl.vfx_set('main', 'scale', 1.25);",
        "1.0": "ctrl.vfx_stop('main');"
      }
    }
  }
}
```

时间轴单位是秒。表达式必须是有效的 Molang；字符串可以使用单引号或双引号，建议保持整套模型文件使用同一种写法，并在函数调用后保留分号。动画还必须被当前 YSM controller 的状态真正引用，只有把指令写进文件而没有进入当前状态时不会触发。

## 函数

### `ctrl.vfx_sound_play(sound_id, slot)` / `ctrl.vfx_sound_stop(slot)`

从 `1.0.0-pre.2-audio.2` 起可播放/停止包内单声道 OGG 短音效。示例：

```molang
ctrl.vfx_sound_play('yesstevevfx:vfx_audio_demo/slash', 'swing');
ctrl.vfx_sound_stop('swing');
```

两行分别放在开始和提前结束的指令帧；放在同一帧会立即停止。音频 slot 与视觉 slot 独立；同实体同 slot 的多次 play 会叠加播放，stop 会停止该 slot 的全部声音。play/stop 返回 1 代表接受排队，0 代表资源、参数、动作上下文或重载状态不允许；停止不存在的合法槽位无害。音量/距离/跟随配置在 `audio.json`，详见 [音效使用说明](AUDIO-USER-GUIDE.md)。声音只在本客户端触发；YSS 命中音效通过可选服务端桥接。

### `ctrl.vfx_play(effect_id, slot)`

启动一个完整 effect。`effect_id` 必须是已经通过 `/vfx_client reload` 加载的完整资源 ID，例如 `yesstevevfx:demo`；`slot` 是来源实体本地的播放槽位，建议使用 `main`、`weapon` 或 `skill_1` 这类稳定名称。

同一个来源实体的同一个 slot 再次播放会停止旧实例并创建新实例。返回 `1` 表示请求已接受并排入客户端执行队列，返回 `0` 表示参数、资源、后端或上下文不可用。

### `ctrl.vfx_play_fixed(effect_id, slot)`

原地播放完整特效：保存指令帧执行时来源实体的世界位置、朝向和俯仰，之后不跟随玩家移动或转身。模型动画和粒子自身运动仍正常执行（固定的是载体根变换，不是冻结粒子）。无需重新导出特效包。

```molang
ctrl.vfx_play_fixed('yesstevevfx:demo', 'skill_origin');
```

将它放在 YSM 动画第 0 帧，并安排在 Root 位移之前，即固定在动作起始位置；如果放在 0.5 秒，它记录的是 0.5 秒触发时的位置，不会倒查动作开始的位置。队列保存的是调用时的坐标值，不会因下一 tick 玩家已移动而改变出生点。

与跟随播放共享 slot：同来源、同 slot 会替换旧特效；需要动作连段叠加时使用不同 slot。`ctrl.vfx_stop('skill_origin')` 和 `ctrl.vfx_set(...)` 同样可用。特效按配置寿命结束，玩家移开不会带走特效；退出世界/reload 会清理。

独立测试：`/vfx_client play_fixed yesstevevfx:demo skill_origin`，随后走开并转身。对照使用 `/vfx_client play yesstevevfx:demo follow_test`。

Blockbench → VFX → 资产与绑定，同时提供“复制跟随播放”和“复制原地播放”，直接粘贴到 YSM 动画的指令帧。

### `ctrl.vfx_play_target(effect_id, slot, mode)`

在 Camera 当前锁定目标的位置播放特效。该函数只在 Camera 提供有效锁定快照时接受请求；没有锁定目标时返回 `0`。

`mode` 有三种值：

- `follow_target`：载体持续跟随锁定目标，适合持续附着在目标身上的法术或状态效果。
- `at_target`：在指令帧执行时记录目标位置，之后固定在该位置，适合命中特效。
- `attach_target`：当前版本按持续跟随处理，为后续接入目标骨骼挂载保留兼容值。

示例：

```molang
ctrl.vfx_play_target('yesstevevfx:spell_hit', 'target_spell', 'follow_target');
ctrl.vfx_play_target('yesstevevfx:impact', 'target_impact', 'at_target');
```

目标特效和普通特效共享来源实体的 slot；同一 slot 再次播放会替换旧实例。目标实体被移除或死亡后，持续跟随实例会自动清理。

### `ctrl.vfx_stop(slot)`

停止当前来源实体指定 slot 的 effect。返回 `1` 表示已接受，返回 `0` 表示该 slot 没有正在运行的实例或请求不合法。已经生成的粒子会按照粒子自身寿命结束；carrier、模型和动画实例会被清理。

### `ctrl.vfx_set(slot, name, value)`

修改正在运行的 effect 参数。`name` 只能包含字母、数字、下划线、点和短横线，`value` 必须是有限数字。`scale` 是测试资源中使用的示例参数，实际可用变量由 eyelib client entity 和动画定义决定。

例如：

```molang
ctrl.vfx_play('yesstevevfx:demo', 'main');
ctrl.vfx_set('main', 'scale', 1.25);
ctrl.vfx_stop('main');
```

## 执行上下文和线程

YSM 可能在 `YSM Worker` 线程评估模型动画。bridge 只保存来源实体 UUID、effect ID、slot、参数以及原地播放的坐标/朝向快照，不保存 YSM entity、Molang context 或 AST，也不在动画评估期间修改实体集合。请求会在客户端 tick 的安全阶段按指令顺序执行。

函数只接受真实客户端实体的动画上下文，并且要求 YSM 当前允许产生动作效果。预览模型、fake player、普通观察性 Molang 求值和没有 `allowEmitting()` 权限的上下文都会返回 `0`。因此在 Blockbench 中应把指令放在实际播放的模型动画 timeline 中，而不是预览专用动画或只用于查询的 Molang 表达式中。

特效载体是客户端本地的无碰撞实体，初始位置取触发指令的 Minecraft 实体，`vfx_play` 后续每 tick 跟随该实体，`vfx_play_fixed` 则保持触发时的根变换。模型、Bedrock 动画和粒子均由 eyelib 渲染，YSM 只负责动画控制。

## 资源和命令

特效资源放在：

```text
config/yesstevevfx/packs/<pack_id>/
```

修改文件后执行：

```text
/vfx_client reload
```

手动播放可以用：

```text
/vfx_client play yesstevevfx:demo main
/vfx_client set main scale 1.25
/vfx_client stop main
```

## 排错

在 `latest.log` 中可以按顺序看到：

```text
YSM ctrl.vfx_play ... accepted=true
Applied queued VFX action: Play[...]
```

第一条表示 YSM timeline 已执行并接受请求，第二条表示客户端 tick 已创建或替换 effect。完全没有第一条时，应先确认 controller 状态确实播放了目标动画；第一条为 `accepted=false` 时，检查 effect ID 是否已 reload、slot 是否为空，以及当前上下文是否为预览实体。

测试版本默认以关闭 Oculus 光影作为验收条件；模型、粒子、序列帧和 alpha 的基础播放应先在这个环境下确认。
