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

### `ctrl.vfx_play(effect_id, slot)`

启动一个完整 effect。`effect_id` 必须是已经通过 `/vfx_client reload` 加载的完整资源 ID，例如 `yesstevevfx:demo`；`slot` 是来源实体本地的播放槽位，建议使用 `main`、`weapon` 或 `skill_1` 这类稳定名称。

同一个来源实体的同一个 slot 再次播放会停止旧实例并创建新实例。返回 `1` 表示请求已接受并排入客户端执行队列，返回 `0` 表示参数、资源、后端或上下文不可用。

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

YSM 可能在 `YSM Worker` 线程评估模型动画。bridge 只保存来源实体 UUID、effect ID、slot 和参数，不保存 YSM entity、Molang context 或 AST，也不在动画评估期间修改实体集合。请求会在客户端 tick 的安全阶段按指令顺序执行。

函数只接受真实客户端实体的动画上下文，并且要求 YSM 当前允许产生动作效果。预览模型、fake player、普通观察性 Molang 求值和没有 `allowEmitting()` 权限的上下文都会返回 `0`。因此在 Blockbench 中应把指令放在实际播放的模型动画 timeline 中，而不是预览专用动画或只用于查询的 Molang 表达式中。

特效载体是客户端本地的无碰撞实体，初始位置取触发指令的 Minecraft 实体，后续每 tick 跟随该实体。模型、Bedrock 动画和粒子均由 eyelib 渲染，YSM 只负责动画控制。

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
