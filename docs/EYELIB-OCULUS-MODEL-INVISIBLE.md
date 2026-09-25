# eyelib b600cb08：Oculus 光影下模型不可见

## 可直接转发给作者

最新版 `b600cb0820d752cb73372b9fdd16d33d32e0a4bf` 的粒子颜色已正常，但开启 Oculus 光影时，Bedrock 模型仍不可见。运行日志确认 eyelib 选择了 `GPU 蒙皮路径 = COMPUTE`，VFX 已加载资源且成功执行模型特效播放。之前将 eyelib 回退到 CPU 顶点提交后，同一测试环境的模型和动画可以正常显示。

具体兼容冲突：eyelib 在 `LegacySkinningManager.registerShadersFor()` 中创建普通 `ShaderInstance`；`BatchSkinningDispatcher.drain()` 调用该 shader 的 `apply()` 后执行 `glDrawArrays()`。Oculus 1.8.0 的 `MixinShaderInstance.iris$lockDepthColorState()` 注入在 `apply` 的 TAIL：当光影管线要求替换 shader，且实例不是 `ExtendedShader` / `FallbackShader` 时，调用 `DepthColorStorage.disableDepthColor()`，将 depth mask 及 RGBA color mask 全部关闭。之后的模型 draw 不会写入画面，直到 `clear()` 才恢复。正常绘制调用本身不必抛异常，因此不一定有模型渲染报错。

建议先在 Forge 1.20.1 检测到 Oculus 时默认禁用 eyelib GPU 蒙皮，使用已有 CPU + `MultiBufferSource` 路径，同时保留显式 JVM 参数覆盖。不能仅切换 `gpuSkinning.mode=vs`：VS 路径也使用同类普通自定义 shader，存在相同触发条件。若要保留 GPU 蒙皮，应单独适配 Oculus 的 shader、顶点格式、绘制阶段及目标缓冲，而不只是恢复 color mask。

## 本次证据

环境：Minecraft 1.20.1 / Forge 47.4.16 / Oculus 1.8.0 / Embeddium 0.3.31 / iterationRP Alpha 0.8.22 / YesSteveVFX 0.1.0。

当前已安装 eyelib 生产 JAR 的 SHA-256：

```text
244172FAC8C4718B8925BC5FC24200FD1A31044D75FAB0BDED28AF826C3CBF89
```

核对的 Oculus JAR SHA-256：

```text
0945DF0CBA0F62B3901DD80C3268E5311B770ECE78C78037A45DB12AC0425FEF
```

2026-09-24 这次运行的关键日志（仅摘录诊断所需内容）：

```text
22:34:36.802 [Oculus] Using shaderpack: iterationRP Alpha 0.8.22.zip
22:34:46.531 [BatchSkinningProgram] GL_VERSION = "4.6.0 NVIDIA 616.92"，函数指针 = true
22:34:46.561 [LegacySkinningManager] GPU 蒙皮路径 = COMPUTE
22:36:36.069 [yesstevevfx.client] Loaded 6 YesSteveVFX effect definition(s)
22:36:43.543 [CHAT] [yesstevevfx] started 'yesstevevfx:test4' in slot 'test'
22:37:02.782 [CHAT] [yesstevevfx] started 'yesstevevfx:test2' in slot '1'
22:37:15.004 [CHAT] [yesstevevfx] started 'yesstevevfx:test5' in slot '1'
```

当前 Java 进程没有 `-Deyelib.gpuSkinning` 覆盖参数；Oculus 配置为 `enableShaders=true`，光影包与日志一致。用户本轮确认粒子正常、模型不显示。之前的 CPU 回退已由用户确认模型恢复；本轮没有重启做同一 b600cb08 JAR 的 CPU/GPU 对照，也没有抓取逐次 draw 的 GL 状态。上述颜色/深度写入屏蔽机制已从本机实际安装的 Oculus JAR 字节码验证，并与公开源码核对一致。

## 具体源码位置

eyelib：

- [LegacySkinningManager.java](https://github.com/TT432/eyelib/blob/b600cb0820d752cb73372b9fdd16d33d32e0a4bf/src/main/java/io/github/tt432/eyelib/bridge/client/render/skinning/adapter/LegacySkinningManager.java#L60)：仍默认启用 GPU；第 275 行注册普通 `ShaderInstance`，第 356 行 VS 路径也使用自定义 shader。
- [BatchSkinningDispatcher.java](https://github.com/TT432/eyelib/blob/b600cb0820d752cb73372b9fdd16d33d32e0a4bf/src/main/java/io/github/tt432/eyelib/bridge/client/render/skinning/adapter/BatchSkinningDispatcher.java#L187)：`setupRenderState()` → 自定义 `shader.apply()` → `glDrawArrays()` → `shader.clear()`。
- [ImmediateRenderSink.java](https://github.com/TT432/eyelib/blob/b600cb0820d752cb73372b9fdd16d33d32e0a4bf/src/main/java/io/github/tt432/eyelib/bridge/client/render/ImmediateRenderSink.java#L38)：关闭 GPU 后使用已有 VertexConsumer / BufferSource 提交路径。

Oculus（以下固定提交源码与本机 1.8.0 JAR 的相关方法逻辑一致，不将该提交冒充发行包的构建提交）：

- [MixinShaderInstance.java，第 73 行](https://github.com/Asek3/Oculus/blob/b3b278134f719afe32ba8b6b5d3a93f052175afc/src/main/java/net/irisshaders/iris/mixin/MixinShaderInstance.java#L73)：在普通 shader 的 `apply()` 末尾关闭写入；`clear()` 开头恢复。
- [DepthColorStorage.java，第 15 行](https://github.com/Asek3/Oculus/blob/b3b278134f719afe32ba8b6b5d3a93f052175afc/src/main/java/net/irisshaders/iris/gl/blending/DepthColorStorage.java#L15)：实际执行 `_depthMask(false)` 和 `_colorMask(false, false, false, false)`。

关键条件等价于：

```java
if (!(shader instanceof ExtendedShader)
        && !(shader instanceof FallbackShader)
        && shouldOverrideShaders()) {
    DepthColorStorage.disableDepthColor();
}
```

Oculus 的 `shouldOverrideShaders()` 最终取决于当前是否正在世界渲染、且主渲染目标被绑定。不能把“所有场景下的自定义 shader 都会被禁用”作为结论。

粒子正常与模型消失并不矛盾：当前粒子通过原版实体 RenderType 和顶点缓冲提交，未进入模型的 GPU 蒙皮路径；修正 RGBA 后能够继续由 Oculus 正常接管。模型 `test4` 使用 `entity_alphatest`，但 GPU 分支在配置 routing RenderType 后仍显式应用自己的 shader，仅材质名称正确不足以兼容。

## 最小兼容补丁与验收

附 [仅包含 Oculus 默认 CPU 回退的补丁](eyelib-oculus-cpu-fallback-b600cb08.patch)，以 `b600cb08` 为基线；已通过 `git apply --check`，未套用到当前上游源码或测试客户端。本补丁只改 `LegacySkinningManager`，无需改 YesSteveVFX、粒子配置、模型或贴图。

处理范围为 Stonecutter `<1.20.6` 分支，使用 Forge `ModList.get().isLoaded("oculus")`。安装 Oculus 时默认回退，即使玩家暂时关闭光影也回退，以覆盖游戏内重新开启光影；会失去相应 GPU 蒙皮优化。显式 `-Deyelib.gpuSkinning=true` 仍可用于开发诊断，其它版本节点保留原行为。

不改源码也可以对照验证：在启动器 JVM 参数加入 `-Deyelib.gpuSkinning=false`，完整重启。同一次进程内 `/vfx_client reload` 无法改变初始化时读取的 `static final ENABLED`。

建议作者验收：

1. 原版 b600cb08，启用 Oculus + iterationRP，播放 `/vfx_client play yesstevevfx:test4 test`。该样例持续 5 秒，应在播放期间观察。
2. 保持同一 JAR、资源与视角，加入 `-Deyelib.gpuSkinning=false` 后重启，再播放 test4 对照。
3. 自动回退补丁下，验证 test1–3 组合特效、test4 模型和 test5 粒子，并验证进入世界后开关光影、重载及停止播放。
4. 默认回退属于兼容措施；若继续开发 GPU 原生兼容，需要另测阴影、透明混合和光影合成，不能仅凭模型重新出现就认定全部正确。
