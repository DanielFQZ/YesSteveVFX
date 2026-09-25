# eyelib 上游更新核对

核对日期：2026-09-24。基线 `9754bbeafe71bf5cef81cc85504cd18d235699e2` → 最新 [b600cb0820d752cb73372b9fdd16d33d32e0a4bf](https://github.com/TT432/eyelib/commit/b600cb0820d752cb73372b9fdd16d33d32e0a4bf)，共 8 个提交、39 个文件变更。

最新源码克隆在 `E:\JavaProject\YesSteveModel\eyelib-upstream`。原 `eyelib-master` 是源码归档目录，不是 Git 仓库，保留其中的修复和构建环境；以后可在新目录正常 fetch/pull。

## 与本次问题直接相关的变化

| 项目 | 上游状态 | 对 YesSteveVFX 的意义 |
| --- | --- | --- |
| 粒子 RGB 一直黑、透明度数值错误 | `919d44cc`：1.20.1 顶点接口的 RGBA 均除以 `255.0F`，新增 2 项回归测试 | 已包含此前定位的直接修复，不能再把问题只归因于环境光照 |
| 光照组件语义反转、局部坐标取光 | `3d277040`：无 lighting 组件时满亮，有组件时按粒子位置加发射器位置查询 | 与此前本地修复等价 |
| Oculus 开光影后模型消失 | **尚未包含自动 CPU 回退**；`LegacySkinningManager` 仍默认 `eyelib.gpuSkinning=true` | 部署后用户确认粒子正常、模型仍不可见；已定位 Oculus 对普通 shader 的颜色/深度写入屏蔽，见[专项反馈](EYELIB-OCULUS-MODEL-INVISIBLE.md) |
| 换模型、状态退出后循环粒子残留 | `b600cb08`：递归清理控制器内子动画登记，并补充锚点更新 | 补全特效的生命周期处理；新增清理测试通过 |

源码位置：

- [BedrockParticleRenderer.java](../../eyelib-upstream/src/main/java/io/github/tt432/eyelib/bridge/particle/adapter/BedrockParticleRenderer.java)：`vertex()`、`getLight()`。
- [LegacySkinningManager.java](../../eyelib-upstream/src/main/java/io/github/tt432/eyelib/bridge/client/render/skinning/adapter/LegacySkinningManager.java)：`ENABLED` 默认值仍为 `true`。
- [BrAnimationController.java](../../eyelib-upstream/src/main/java/io/github/tt432/eyelib/animation/bedrock/controller/BrAnimationController.java)：`drainAllParticles()`。

Oculus 所需的处理见 [此前的修复说明](EYELIB-RENDER-FIXES-1.20.1.md)第 3 节。旧补丁是针对旧源码制作的，颜色、光照部分现已进入上游，不宜再整份套用。CPU 回退是当前测试环境已验证的兼容措施，不代表上游 GPU 渲染链已经支持 Oculus。

## 其它相关更新

- CUSTOM 粒子发射方向改为归一化后乘 16，并保护零向量；修正原先自定义方向速度过低。
- 新增 `particle_motion_collision` 的方块碰撞盒查询、推出、反弹、阻力和接触消失处理。其事件字段仍只解析、不派发；本次未做碰撞的游戏内验证，不能视为完整 Bedrock 碰撞兼容验收。
- Compute 蒙皮解除误套的 96 骨骼限制，几何创建失败进入负缓存，避免逐帧重复尝试。
- AcceleratedRendering 编译依赖已随仓库提供，旧的 Modrinth 坐标替换脚本不再需要。clientsmoke、LDLib2 的本机 Maven 前置仍然需要。
- 修正 NullAway 可空性契约；新增 `EntityPort.fromCached`；修正 26.1.2 测试环境依赖。本次只验证 Forge 1.20.1。

## 实测构建结果

| 验证 | 结果 |
| --- | --- |
| eyelib `compileJava` / `reobfJar` | 通过，已生成生产 JAR |
| eyelib `nullawayMain` | 通过，此前 23 项检查错误已被上游处理 |
| eyelib 完整单元测试 | 1706 项：1701 通过、4 失败、1 跳过 |
| 新增颜色与粒子清理测试、方向测试 | 均通过 |
| YesSteveVFX `compileEyelibJava` | 针对新版开发 JAR 编译通过，无需修改 VFX 源码 |
| YesSteveVFX 核心测试 | Gradle `UP-TO-DATE`，复用现有结果，不是新增游戏内验证 |

4 个失败与之前一致：`BedrockGeometryImporterTest`、`BedrockImportedModelDataTest` 各 2 项，缺少 `test.geo.json` 夹具。仓库 `.gitignore` 的 `test.geo.json` 规则会忽略这个文件，作者需要补交真实夹具。含完整测试的联合命令最终退出码为 1，因此不能声称“完整构建全部通过”。

证据：[eyelib 验证日志](../../eyelib-upstream/build/upstream-verification.log)、[VFX 兼容性日志](../build/eyelib-upstream-compatibility.log)、[本机构建说明](../../eyelib-upstream/docs/local-build-1.20.1.md)。本次仅调整 Foojay 版本及 RenderDoc 工具链延迟解析，Java 源码和资源保持上游内容。

## 客户端状态与建议

最新上游生产包：[eyelib-21.1.14+1.20.1-forge.jar](../../eyelib-upstream/versions/1.20.1/build/libs/eyelib-21.1.14+1.20.1-forge.jar)，SHA-256 `244172FAC8C4718B8925BC5FC24200FD1A31044D75FAB0BDED28AF826C3CBF89`。该包已部署，用户实测粒子正常、模型仍不可见。当前日志确认开启 iterationRP 光影且使用 COMPUTE 蒙皮；诊断和作者反馈见[专项报告](EYELIB-OCULUS-MODEL-INVISIBLE.md)。

此前包含 Oculus CPU 回退的本地修补版已备份到 `E:\Games\YSM拍摄端\mod-backups\eyelib-before-upstream-b600cb08-20260924-223253`，SHA-256 `D294E98CCB1F83168D6A540986EB9F5E6AEA0CADE73AD6C2D4450A4DDF15FB5C`。两包版本号和文件名相同，不能仅靠名称判断内容。

建议以上游新提交作为后续开发基线，由作者补上 Oculus 回退；若先使用纯上游包测试，则在启动器中加入 `-Deyelib.gpuSkinning=false` 并完整重启客户端。再分别播放 `yesstevevfx:test5`（粒子）、`yesstevevfx:test4`（模型）、test1–3（组合）验证开关光影及停止、重载后的清理行为。
