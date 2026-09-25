# eyelib 1.20.1 粒子随视角变暗

适用基线：eyelib `b600cb0820d752cb73372b9fdd16d33d32e0a4bf`，Minecraft 1.20.1 / Forge 47.4.16，关闭光影。源码修复归属 eyelib 的 `bridge` 模块；本地补丁 JAR 是等待作者合入前的测试版本。

## 已确认的原因

用户观察到低头时粒子变暗，抬头时恢复鲜艳。测试包的 particle1/2/3 都是 `particles_alpha`，`facing_camera_mode` 为 `rotate_xyz`，没有 `minecraft:particle_appearance_lighting`。

eyelib 的 `BedrockParticleRenderer.CachedRender.create()` 将该材质映射到 `RenderType.entityCutoutNoCull()`。`getLight()` 虽然正确返回 `LightTexture.FULL_BRIGHT`，但原版顶点 shader 还会执行：

```glsl
vertexColor = minecraft_mix_light(Light0_Direction, Light1_Direction, Normal, Color);
```

Minecraft 1.20.1 的 `light.glsl` 对 RGB 乘以 `min(1, (light0 + light1) * 0.6 + 0.4)`，alpha 不受该乘数影响。朝向镜头的粒子面片，其法线随视角改变，因此会在 40% 到 100% 之间改变亮度。满亮 lightmap 只解决天空光／方块光，不会禁用方向光。

这解释了有颜色但偏暗、透明轮廓正常，以及明暗随视角变化的现象。此前 RGBA 整数未归一化导致近乎纯黑的错误已在上游修复，是另一处问题。VFX 的跟随插值改动没有修改颜色和材质；不能仅凭出现时间认定是跟随逻辑改坏了颜色。

**不能直接换成 `entityTranslucentEmissive()`：** 1.20.1 的同名顶点 shader 也调用 `minecraft_mix_light`，虽然不采样 lightmap，仍会随法线变暗；直接换 RenderType 还会改变混合和深度写入。

## 源码修复

[源码补丁](eyelib-particle-view-lighting-b600cb08.patch) 只包含两个文件，不包含本机 Gradle 适配：

- [BedrockParticleRenderer.java](../../eyelib-upstream/src/main/java/io/github/tt432/eyelib/bridge/particle/adapter/BedrockParticleRenderer.java)：仅在 Forge 1.20.1 的 `ALPHA_TEST` 且 lighting 组件为空时选用新通道。
- [UnlitParticleRenderType.java](../../eyelib-upstream/src/main/java/io/github/tt432/eyelib/bridge/particle/adapter/UnlitParticleRenderType.java)：复用 Forge 注册的 `ForgeHooksClient.ClientEvents.getEntityTranslucentUnlitShader()`，它直接使用 `vertexColor = Color`。

shader 的名字带 `translucent`，但自定义 RenderType 使用 `NO_TRANSPARENCY`、`LEQUAL_DEPTH_TEST`、`COLOR_DEPTH_WRITE`，并保留原有剔除设置、lightmap 和 overlay。shader 的纹理 alpha 裁剪仍是 `< 0.1`；没有把 `particles_alpha` 改成 `particles_blend`。通过 supplier 获取 shader，资源重载后不会引用旧 ShaderInstance。RenderType 沿用按 ParticleDefinition 的缓存。

这次针对当前测试资源的无光照 alpha-test 粒子；显式 lighting、其它材质和其它 MC 节点保持现状。无需修改 YSM、VFX 播放／跟随代码或粒子 JSON。它不产生 Bloom 辉光，也未声明 Oculus 兼容。

## 验证证据

1. `:1.20.1:reobfJar`、`:1.20.1:nullawayMain` 通过，生产 JAR 字节码确认包含新通道与 SRG 方法引用。
2. 全量单元测试：1706 项，1701 通过、4 失败、1 跳过。失败与 [既有验证记录](../../eyelib-upstream/build/upstream-verification.log) 相同，来自两个模型导入测试类缺少 `test.geo.json`，没有新增失败。[本次完整日志](../../eyelib-upstream/build/particle-unlit-verification.log)。联合命令因这 4 个测试最终退出码为 1，不能称为全量构建全绿。
3. 使用 [ParticleShaderProbe.java](../tools/ParticleShaderProbe.java) 从 Minecraft client JAR 和 Forge universal JAR 读取实际 GLSL，在 RTX 4080 的隐藏 OpenGL 上下文中绘制、回读像素，不是用 Java 重写 shader 公式模拟结果。

| 实际 shader | 法线朝下 RGB | 法线朝上 RGB |
| --- | --- | --- |
| 原版 entity_cutout_no_cull | `(32,88,48)` | `(80,220,120)` |
| 原版 entity_translucent_emissive | `(32,88,48)` | `(80,220,120)` |
| Forge entity_unlit_translucent | `(80,220,120)` | `(80,220,120)` |

输入纹理为 `(80,220,120,255)`，lightmap 为白色。修复所用 shader 的六个法线方向结果一致；alpha=0 被裁剪，alpha=128 保留颜色与 alpha；改暗 lightmap 时仍能按光照贴图调制。完整结果见 [GPU 检查日志](../build/particle-shader-probe.log)。该检查证明 shader 本身的行为，不等于完整客户端的材质接线、模组组合和画面验收；目前没有 clientsmoke 运行报告。

构建命令：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.5.11-hotspot'
.\gradlew.bat :1.20.1:reobfJar :1.20.1:nullawayMain :1.20.1:test --continue --no-daemon --no-configuration-cache --console=plain
```

GPU 检查：用 Java 17 或 21 执行 `tools/ParticleShaderProbe.java`；classpath 包含 LWJGL 3.3.1 的 lwjgl、lwjgl-glfw、lwjgl-opengl 及对应平台 natives JAR，两个参数分别为 Minecraft 1.20.1 client JAR 和 Forge 47.4.16 universal JAR 的绝对路径。

## 客户端复测

正常退出游戏后替换 eyelib，再完整重启；`vfx_client reload` 只能重载资源，不能替换 Java 类。关闭光影执行：

```text
/vfx_client play yesstevevfx:test5 test
/vfx_client play yesstevevfx:test1 test
/vfx_client play yesstevevfx:test4 test
```

分别验证纯粒子、组合、纯模型。低头、平视、抬头对比粒子颜色；走动和跳跃验证跟随；观察透明轮廓和模型颜色；reload 后再次播放确认 shader 资源重载仍可用。完整客户端视觉结果待复测。

生产包 SHA-256：`23A358851A42436905414DE14DA40EBFD4D2B647B1D8AB0CC0191E9BD21AC396`。

2026-09-26 00:16，用户正常退出客户端后已部署到 `E:\Games\YSM拍摄端\.minecraft\versions\1.20.1-Forge_47.4.16\mods\eyelib-21.1.14+1.20.1-forge (4).jar`，复制后哈希一致。旧包备份目录：`E:\Games\YSM拍摄端\mod-backups\eyelib-before-particle-view-lighting-20260926-001647`，旧包 SHA-256 为 `6A601B79162000B1491BFC3C574532B5B44B6207FA7CF1354544BE38D09B8B63`。

当前 VFX 包仍为已验证跟随平滑的构件，SHA-256 为 `9FBE3102C3898B0EC38D9227BAF32BAAD73A88F5AF1A81ACCB0987329BD9D7E0`。[部署记录](../build/particle-unlit-deployment.json)。客户端视觉复测尚未完成。
