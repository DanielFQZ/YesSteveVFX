# 贴图原色材质测试说明

适用：Forge 1.20.1，eyelib `feat/texture-color-material` 测试分支，Studio `1.0.0-pre.2-audio.7`。

## 使用

替换配套 eyelib 后完整重启 Minecraft。Blockbench 的 **VFX → 资产与绑定 → 特效绑定** 勾选 **贴图原色**，或在 **粒子与贴图 → 粒子光照** 选择 **贴图原色**。保存工程绑定/导出客户端包，在游戏执行 `/vfx_client reload`，重新播放特效。

不用修改 YSM、Molang 调用或 YesSteveVFX Java 代码。模型全亮与原色是不同选项；原色优先，关闭原色后恢复原来的全亮设置。导出的材质需要本次 eyelib fork，普通上游 JAR 不支持。

## 语义

- shader 输出贴图乘动画/粒子 tint 与 alpha，不使用环境光、面朝向光、overlay 或雾。
- 保留动画颜色和透明度。半透明、加法混合的最终像素会混合背景，不能等同于图片 RGB。
- 模型与粒子在世界阶段收集顶点，Oculus 主要合成结束后、手持物清除世界深度前提交，跳过阴影 pass。此材质当前使用 CPU 顶点路径。
- 显式恢复深度写入初始状态，修复 Oculus final pass 留下的 `depthMask(false)`；退出后恢复之前的深度写入状态。
- 不参与光影的 Bloom、反射或场景光照。水、玻璃等半透明物体无法与这一晚绘制通道交叉排序，折射/TAA/自定义深度及额外屏幕后处理有兼容边界。
- Blockbench 预览使用等价的标准粒子混合材质；eyelib 扩展材质名仅用于游戏资源。切回环境光/普通全亮会还原粒子的标准材质。

## 配置

实体 `description.materials.default`：`eyelib:texture_unlit`。

| 粒子原材质 | 原色材质 |
| --- | --- |
| `particles_alpha` | `eyelib:texture_unlit_alpha` |
| `particles_blend` | `eyelib:texture_unlit` |
| `particles_add` | `eyelib:texture_unlit_add` |
| `particles_opaque` / `particles_base` | `eyelib:texture_unlit_opaque` |

未知自定义粒子材质不会猜测转换，以免改变混合行为。编辑器给出错误，需保留“跟随源 JSON”或另行适配。

## 验证范围

2026-10-02，开发客户端 Forge 47.1.3、Oculus 1.8.0、Embeddium 0.3.31：

- 无光影：GPU 输出与实际世界阶段入队/提交检查通过，改变法线和 packed light 不改变 RGB；alpha 混合及深度遮挡符合预期。
- Nostalgia v4.0a：GPU 输出与实际世界阶段入队/提交检查通过。
- iterationRP Alpha 0.8.22：GPU 输出与实际世界阶段入队/提交检查通过。
- 两项可复用客户端检查在 eyelib 的 `smoke/TextureColorSmoke` 和 `smoke/TextureColorWorldSmoke`，像素容差 2/255。
- Studio 的 40 项 Node 测试通过，覆盖保存、重新导入、源文件保护、材质混合及预览转换。

这些检查使用受控几何与颜色，不替代实际 Bedrock 特效包的视觉验收。eyelib 全量单测仍有四个既存的缺失模型 fixture 失败；完整 clientsmoke 后续 Spider 用例因未进入 eyelib 实体渲染而失败，因此不宣称整套上游测试全部通过。

源码归属：[eyelib fork 分支](https://github.com/DanielFQZ/eyelib/tree/feat/texture-color-material)。当前为可回退的测试实现，尚未向上游提交 PR。
