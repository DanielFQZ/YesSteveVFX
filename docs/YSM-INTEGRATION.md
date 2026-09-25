# YSM Molang 控制

函数参数、Blockbench 操作和常见问题的完整说明见 [MOLANG-REFERENCE.md](MOLANG-REFERENCE.md)。本页保留运行时接入示例和生命周期说明。

安装 YSM 后，YesSteveVFX 会在客户端注册三个 `ctrl` 函数。它们只能从真实模型实体的动作阶段执行，例如动画 `timeline` 指令帧；预览模型、fake player 和普通的观察性 Molang 求值会返回 `0`，不会创建特效。

## 动画文件示例

YSM 动画的 `timeline` 时间单位是秒。下面的动画在 0 秒播放特效，0.25 秒修改参数，1 秒停止：

```json
{
  "animations": {
    "animation.demo.vfx": {
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

`vfx_play(effect_id, slot)` 使用已经由 `/vfx_client reload` 加载的 effect ID；同一来源实体的同一 slot 再次播放会替换旧实例。`vfx_set(slot, name, value)` 修改运行中实例的数值变量，例如 `scale` 会写入 eyelib 的 `variable.scale`。`vfx_stop(slot)` 停止该 slot。

三个函数返回 `1` 表示本次请求已接受，返回 `0` 表示参数、资源、实体或运行时不可用。特效的实际创建、替换和停止会在客户端 tick 的安全阶段按指令顺序执行，因此指令帧不会在 YSM 渲染遍历期间修改实体集合；函数调用本身不会保存 YSM 的实体、上下文或 AST。

特效载体持续跟随执行该指令帧的实体。模型、粒子和动画仍由 eyelib 推进，YSM 只负责动作帧和 Molang 控制。特效文件仍放在客户端 `config/yesstevevfx/packs`，YSM 模型不需要复制这些资源。
