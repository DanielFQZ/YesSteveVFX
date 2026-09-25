# YesSteveVFX 使用说明

YesSteveVFX 的一个特效由一个 effect 定义和一组 eyelib Bedrock 资源组成。资源放在客户端游戏目录的 `config/yesstevevfx/packs/<pack_id>/` 下；修改资源后重启客户端或执行 `/vfx_client reload`。

客户端需要 Minecraft 1.20.1。YesSteveVFX 的当前构件支持 Forge 47.0.0 及之后的 47.x 版本；如果整合包同时安装了 YSM 或 eyelib，还必须满足它们各自声明的 Forge 最低版本。

YSM 动画控制的 Molang 函数规范、Blockbench 指令帧写法和排错日志见 [MOLANG-REFERENCE.md](MOLANG-REFERENCE.md)。

## 目录结构

```text
config/yesstevevfx/packs/my_pack/
├── manifest.json
├── effects/fireball.json
└── assets/eyelib/
    ├── entity/fireball.json
    ├── models/fireball.geo.json
    ├── animations/fireball.animation.json
    ├── animation_controllers/*.json       # 可选
    ├── render_controllers/fireball.json
    ├── particles/fireball.json             # 可选
    └── textures/fireball.png
```

## manifest.json

```json
{
  "format_version": 1,
  "pack_id": "my_pack",
  "display_name": "My effects",
  "effects": ["effects/fireball.json"]
}
```

`pack_id` 只能使用小写字母、数字、点、下划线和短横线。`effects` 中的每个文件都会注册一个可播放的 effect。

## effect 定义

```json
{
  "format_version": 1,
  "id": "my_pack:fireball",
  "duration_ticks": 60,
  "client_entity": "assets/eyelib/entity/fireball.json"
}
```

`id` 是播放时使用的完整资源 ID，`duration_ticks` 是实例最长生命周期，`client_entity` 指向该特效使用的 Bedrock client entity 文件。

## Bedrock 资源

client entity、geometry、animation、render controller 和 particle 的标识符必须使用 `yesstevevfx` 命名空间，例如：

```json
{
  "minecraft:client_entity": {
    "description": {
      "identifier": "yesstevevfx:fireball",
      "textures": {"default": "yesstevevfx:textures/fireball"},
      "geometry": {"default": "geometry.yesstevevfx.fireball"},
      "animations": {"main": "animation.yesstevevfx.fireball"},
      "render_controllers": ["controller.render.yesstevevfx.fireball"],
      "scripts": {"animate": ["main"]}
    }
  }
}
```

纹理文件放在 `assets/eyelib/textures/` 中，JSON 中通常写不带 `.png` 的路径。YesSteveVFX 会同时发布带扩展名和不带扩展名的纹理别名，模型和粒子可以共用同一张图。

动画中的粒子事件通过 client entity 的 `particle_effects` 短名映射到粒子 ID：

```json
"particle_effects": {
  "spark": "yesstevevfx:fireball/spark"
}
```

动画事件写成 `"effect": "spark"`。粒子贴图使用 Bedrock 的 `particle_appearance_billboard.uv` 定义序列帧区域。

## 客户端命令

```text
/vfx_client reload
/vfx_client play my_pack:fireball main
/vfx_client set main scale 1.25
/vfx_client stop main
```

`reload` 会报告当前加载的 effect 数量。输入 `/vfx_client play` 后，effect 参数会从当前已加载的 effect ID 中自动补全。

## YSM 控制

安装 YSM bridge 后，可以在 YSM 动画指令帧的 Molang 中调用：

```text
ctrl.vfx_play("my_pack:fireball", "main")
ctrl.vfx_set("main", "scale", 1.25)
ctrl.vfx_stop("main")
```

指令帧的完整 JSON 示例、执行阶段和返回值说明见 [YSM-INTEGRATION.md](YSM-INTEGRATION.md)。

特效载体会跟随触发它的 YSM 实体。载体更新时保留上一 tick 的坐标和旋转，模型与粒子使用 Minecraft/eyelib 的帧间插值，因此不会按 20 tick/s 产生阶梯式跟随。YSM 负责控制调用，eyelib 负责 Bedrock 模型、动画和粒子渲染。
