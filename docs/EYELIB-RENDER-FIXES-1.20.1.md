# eyelib 1.20.1 粒子颜色与 Oculus 模型兼容修复

用于反馈给 eyelib 作者。环境：Minecraft 1.20.1、Forge 47.4.16、eyelib 21.1.14 本地构建、Embeddium 0.3.31、Oculus 1.8.0、iterationRP Alpha 0.8.22。

本次修改归属 eyelib 的 `bridge` 模块；YesSteveVFX 的播放控制和资源格式不需要为此修改。随附 [源码补丁](eyelib-render-fixes-1.20.1.patch)，应合入 eyelib 作者维护的源码。本地修补 JAR 仅用于验证。

## 1. 粒子始终发黑：浮点颜色接口收到了整数颜色

文件：`src/main/java/io/github/tt432/eyelib/bridge/particle/adapter/BedrockParticleRenderer.java`，`vertex()` 的 `<1.20.6` 分支。

错误写法：

```java
vertexConsumer.vertex(position.x, position.y, position.z,
        FastColor.ARGB32.red(color),
        FastColor.ARGB32.green(color),
        FastColor.ARGB32.blue(color),
        FastColor.ARGB32.alpha(color),
        u, v, OverlayTexture.NO_OVERLAY, light,
        normal.x, normal.y, normal.z);
```

这个 `vertex(float x, float y, float z, float red, float green, float blue, float alpha, ...)` 重载要求 RGBA 为 `0..1`。ARGB 提取函数返回 `0..255` 的整数；Java 将它们转换成 float 时不会归一化。

Minecraft 1.20.1 `BufferBuilder.vertex()` 的实际打包逻辑为：

```java
this.putByte(12, (byte) ((int) (red * 255.0F)));
```

因此白色通道 `255` 会被乘成 `65025`，截断为字节后是 `1`。最终顶点颜色为 `(1, 1, 1, 1)` 字节值，而不是 `(255, 255, 255, 255)`。RGB 仅剩约 `1/255`，无论环境光照多强、是否启用光影，都近乎黑色。Embeddium 的 `ColorU8.normalizedFloatToByte()` 同样执行乘 255 后取低 8 位，不能修正上游传入范围错误。

修复为：

```java
vertexConsumer.vertex(position.x, position.y, position.z,
        FastColor.ARGB32.red(color) / 255.0F,
        FastColor.ARGB32.green(color) / 255.0F,
        FastColor.ARGB32.blue(color) / 255.0F,
        FastColor.ARGB32.alpha(color) / 255.0F,
        u, v, OverlayTexture.NO_OVERLAY, light,
        normal.x, normal.y, normal.z);
```

RGBA 四个通道都要修。后续版本的 `.setColor(int, int, int, int)` 接口接收整数，不能对那个分支照搬除以 255。

**为什么透明轮廓看起来正常？** 测试资源使用 `particles_alpha`，当前被映射到 `entityCutoutNoCull`。原版片元 shader 先读取纹理并执行 `color.a < 0.1` 裁剪，随后才乘顶点颜色；这个 cutout 通道不使用普通透明混合。因此保留纹理裁剪轮廓并不能证明提交的顶点 alpha 正确。

**修正之前的判断：** 光照分支确有错误，但不能把它认定为这次“所有环境下都黑”的唯一原因。修正光照后依然发黑，是因为上述颜色范围错误仍然存在。

## 2. 粒子光照：修正组件语义与取样坐标

同一文件的 `getLight()`。

[Mojang 官方说明](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/particlesreference/particlecomponents/minecraftparticle_appearance_lighting?view=minecraft-bedrock-stable)：存在 `minecraft:particle_appearance_lighting` 时，粒子才受本地环境光照染色。

正确分支是：

```java
if (lighting == null) {
    return fullBrightLight();
}
```

原实现是 `lighting != null` 时满亮，语义相反。上一轮测试 JAR 已修正这个分支，但还没有修正第 1 节的颜色范围。

对于显式启用环境光照的粒子，原代码直接用局部 `particle.position()` 查询世界光照，遗漏了发射器位置。本补丁按当前 `render()` 的平移顺序取样：

```java
Vector3f worldPosition = new Vector3f(particle.position())
        .add(particle.emitter().position());
BlockPos blockPosition = new BlockPos(
        Mth.floor(worldPosition.x),
        Mth.floor(worldPosition.y),
        Mth.floor(worldPosition.z));
```

使用副本，不能直接修改粒子保存的位置。当前渲染顺序先平移局部位置再乘发射器矩阵，因此中心为两者平移之和；若后续调整 local-space 的旋转或缩放顺序，渲染和光照应共同使用同一个世界位置计算，不能只在光照路径旋转位置。

测试资源 particle1/2/3 都没有 lighting 组件，因此此次颜色复测依赖满亮分支；受光粒子的坐标修正仍需另做运行时用例。

## 3. Oculus 下模型消失：回退到 CPU 蒙皮

文件：`src/main/java/io/github/tt432/eyelib/bridge/client/render/skinning/adapter/LegacySkinningManager.java`。

原默认值为 `System.getProperty("eyelib.gpuSkinning", "true")`。客户端日志显示选择 `COMPUTE`；GPU 路径的 `BatchSkinningDispatcher` 在设置 routing RenderType 后调用自己的 `shader.apply()` 和 `glDrawArrays()`，不等同于交给 Oculus 当前实体 shader 绘制。

临时兼容措施：Forge 1.20.1 检测到 Oculus 后，默认禁用 eyelib GPU 蒙皮，使用已有的 CPU 蒙皮和顶点提交路径。用户已经确认这一处理使模型与动画在光影下恢复显示。

```java
private static final boolean ENABLED = Boolean.parseBoolean(System.getProperty(
        "eyelib.gpuSkinning", defaultGpuSkinningSetting()));

private static String defaultGpuSkinningSetting() {
    // 放在 Stonecutter 的 <1.20.6 分支，使用 Forge ModList。
    return ModList.get().isLoaded("oculus") ? "false" : "true";
}
```

完整补丁包含版本条件，其他节点保留原默认值。显式 `-Deyelib.gpuSkinning=true` 仍可用于诊断；`false` 可强制回退。

这不是 GPU 管线已经兼容 Oculus 的声明。它会在安装 Oculus 后对 eyelib 模型默认使用 CPU，即使暂时关闭光影也如此，可能增加 CPU 开销。这样可覆盖游戏内随时开启光影的情况。真正保留 GPU 的兼容方案仍需作者适配 shader、顶点格式、绘制阶段和 framebuffer，单靠 RenderType 名字不能保证兼容。

## 4. 源码落点与验证方法

修复应写入根目录 `src/main/java/...`。本地构建使用 Stonecutter，`versions/1.20.1/build/generated/stonecutter/...` 是生成目录；仅修改其中的文件会在下一次生成时丢失。之前的临时构建中两项兼容改动只存在于生成源码和 JAR，本补丁已把它们落实到根源码。

新增 `BedrockParticleRendererTest` 通过反射调用真实 `vertex()`，写入 Minecraft `BufferBuilder` 的 `NEW_ENTITY` 格式，再读取四个顶点的 RGBA 字节。用例覆盖白色、纯绿色、半透明彩色、完全透明彩色，不依赖光照或 shader，也没有用另一份颜色转换实现模拟结果。

旧代码的 4 个用例全部失败，其中白色用例实际报错：

```text
R ==> expected: <255> but was: <1>
```

顶点缓冲区测试证明提交数据正确；实际 Oculus 合成后的画面仍须在客户端复测。

## 5. 本地验证和部署结果（2026-09-24）

- 修复前：4 组颜色回读用例全部失败；[原始结果](../../eyelib-master/build/particle-color-before.xml)。
- 修复后：上述 4 组用例通过；粒子、纹理、蒙皮相关目标测试合计 105 项全部通过。编译与 `:1.20.1:reobfJar` 成功；[构建日志](../../eyelib-master/build/particle-color-after.log)。
- 全量测试：共 1,706 项，4 失败、1 跳过；失败仍来自缺失的 `bedrock/test.geo.json` 夹具，与此次改动前记录一致。
- NullAway：仍有 23 个现有错误，包括 `MolangScope`、`ModelRuntimeData`、`LegacySkinningManager.Mode.requested()` 原有的 null 返回值；[完整检查日志](../../eyelib-master/build/particle-render-full-check.log)。没有跳过这些检查来宣称完整构建全绿。
- 生产 JAR 已用 `javap` 复核四次浮点除法、lighting 分支、世界位置相加与 Oculus 默认回退；ZIP 完整性和 Forge 元数据检查通过。
- 模型回退的运行时效果已由用户确认。新粒子修补包尚未完成游戏画面复测，测试客户端未开放 clientsmoke 调试服务；不把无窗口的缓冲区测试称为完整渲染验收。

使用的构建命令（Windows，Gradle 启动 JDK 21，编译工具链 Java 17）：

```powershell
.\gradlew.bat :1.20.1:test --tests '*BedrockParticleRendererTest' --tests '*Particle*Test' --tests '*NativeImageIOTest' --tests '*SkinningGeometryPackerTest' :1.20.1:reobfJar -I gradle/local-ar.gradle --no-daemon --no-configuration-cache
.\gradlew.bat :1.20.1:test :1.20.1:nullawayMain -I gradle/local-ar.gradle --continue --no-daemon --no-configuration-cache
```

`gradle/local-ar.gradle` 只处理这台机器的依赖替代，作者已有完整依赖时按自己的正常构建流程执行即可。此次修补未改 Gradle 配置，也未改 eyelib 的第三方依赖。

已部署到：

```text
E:\Games\YSM拍摄端\.minecraft\versions\1.20.1-Forge_47.4.16\mods\eyelib-21.1.14+1.20.1-forge.jar
SHA-256: D294E98CCB1F83168D6A540986EB9F5E6AEA0CADE73AD6C2D4450A4DDF15FB5C
```

替换前的版本保存在同目录 `eyelib-21.1.14+1.20.1-forge.jar.before-particle-color-fix.bak`，SHA-256 为 `D258363540D4572815D0518D7706332C2678E1A11CD0123C641A9C5C3A15FE9F`。

补丁以本地原始 `src` 为基准，包含两个生产源码文件和新增测试，已通过反向应用检查。作者可先在自己的 eyelib 仓库执行 `git apply --check eyelib-render-fixes-1.20.1.patch`；若源码版本不同，应按以上方法手动合并。

## 6. 客户端复测

替换 eyelib 后须完整重启客户端，`/vfx_client reload` 不能重载 Java 类。

```text
/vfx_client play yesstevevfx:test5 test
/vfx_client play yesstevevfx:test4 test
```

先关闭光影测试纯粒子的颜色和纹理裁剪，再开启 iterationRP 测试同一效果；用 test4 确认模型回退没有退化。test1～3 用于验证模型与粒子组合。声明 lighting 的粒子另在白天、洞穴、火把附近测试，并在远离世界原点的位置重复，确认取样跟随实际粒子位置。
