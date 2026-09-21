# YesSteve VFX

Forge 1.20.1 / 47.4.16 的视觉特效框架，目标是为 YSM 模型提供“洞口/虚拟深度”场景。

## 当前实现

- 服务端 `/vfx portal play`、`stop`、`clear` 指令。
- S2C 同步活动洞口状态。
- 客户端在 `AFTER_SOLID_BLOCKS` 绘制一个写入深度的虚拟洞口。
- 客户端在 `AFTER_PARTICLES` 绘制动画火焰边缘。
- 不修改方块、不创建维度、不依赖 YSM 内部实现。

YSM 模型只要作为普通实体参与世界渲染，就会与洞口平面共享 Minecraft 深度缓冲，因此可以视觉上从洞口前后穿过。后续如果需要“洞内专属模型”，再增加 PortalContentRenderer API。

## 命令

```text
/vfx portal play <id> <x> <y> <z> <radiusX> <radiusZ> <depth>
/vfx portal stop <id>
/vfx portal clear
```

示例：

```text
/vfx portal play boss_gate 100.5 64 200.5 6 4 12
```

命令使用执行者所在维度。当前 `depth` 已同步并保存在状态中，下一步用于视差/虚拟底面采样。

## 构建

```text
gradlew.bat build
gradlew.bat runClient
```

YSM 是可选客户端依赖；VFX 核心不编译依赖 YSM 私有类，避免和 YSM 的 native renderer、模型生命周期产生耦合。

## YSM 配合方式

YSM 的 `GeoReplacedEntityRenderer` 最终仍然通过普通的 `PoseStack`、`MultiBufferSource` 和 `RenderType` 写入 Minecraft 世界渲染。因此本 MOD 不需要调用 YSM 私有 renderer：只要 YSM 模型对应的实体处在洞口前方，它就会和洞口平面共享深度测试。

如果以后需要“只在洞内绘制的 YSM 模型”，再增加一个可选的 YSM 扩展入口，监听 YSM 的 `RenderModelEvent`，将模型写入洞口专用的渲染目标；当前版本刻意不引入 YSM 编译依赖。

其他 MOD 若不想拼接命令字符串，也可以调用 `com.elfmcys.ysmvfx.api.VfxApi`。
