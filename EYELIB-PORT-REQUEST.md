# Eyelib 稳定 Port 改造需求

这份说明用于 YesSteveVFX 接入 eyelib 1.20.1 Forge。目标不是重写现有粒子引擎，而是把当前已经能运行的 Bedrock/Snowstorm 粒子核心包装成稳定的外部 API。

## 结论

如果 eyelib 作者已经明确承诺当前内部接口会随版本维护，那么不必为了 YesSteveVFX 专门新增第三方 Facade。YesSteveVFX 可以直接使用当前接口，但必须固定 eyelib 的源码提交/构件版本，并在本项目内部包一层 `EyelibParticleBackend`。下面的 Facade 设计可以作为长期演进方向，而不是当前接入的前置条件。

当前 eyelib 源码有可用的内部接入点，但还没有适合第三方 Mod 长期依赖的稳定 Port。

即使直接使用，仍应在 YesSteveVFX 内部隔离以下问题：

- `ParticlePort.getSpawnAdapter()` 返回具体的 `ParticleSpawnRuntimeAdapter`，外部模块会绑定内部实现。
- 资源发布需要直接调用 `ParticleResourcePublication` 静态方法。
- 运行时环境依赖全局 `configure(...)`，不利于多个 Mod 或测试环境共存。
- `ParticleSpawnRequest` 缺少实体、世界、AABB、父 Molang scope 和资源 generation 等上下文。
- 默认实体 AABB 取本地玩家，远端实体、投射物和骨骼特效不能可靠使用。
- README 中的 Maven 构件与当前源码的包名/API 不一致，不能直接当作当前源码的稳定二进制接口。

现有发射器、粒子生命周期、Molang 曲线、billboard、flipbook、tint、lighting、motion、kill plane 和 Forge 渲染接入可以继续保留。

## 第一阶段：增加稳定公共 Facade

公共 API 建议放在：

`io.github.tt432.eyelib.particle.api`

建议提供以下接口：

```java
public interface BedrockParticlePort {
    ParticleLoadReport replaceDefinitions(
            String sourceKey,
            Map<String, JsonElement> resources
    );

    void spawn(ParticleSpawnRequest request);
    void updatePose(String spawnId, Matrix4fc pose);
    void remove(String spawnId);
    void clearOwned(String ownerId);
}
```

也可以拆成 `ParticleDefinitionPort` 和 `ParticleSpawnApi` 两个接口。关键是 `ParticlePort` 只返回接口，不返回具体 Adapter：

```java
public interface ParticlePort {
    static ParticleSpawnApi getSpawnApi() {
        return ParticleRuntimeBridge.SPAWN_API;
    }
}
```

`ParticleSpawnRuntimeAdapter` 可以保留为内部实现，但不能成为外部模块的依赖类型。

## 第二阶段：增加可选运行时上下文

第一阶段可以先由 YesSteveVFX 自己维护实体位置，并通过 `updatePose` 更新粒子位姿。

后续建议增加 `ParticleSpawnContext`，或者给 `spawn` 增加带上下文的重载。上下文至少应能表达：所属世界、目标实体或 UUID、目标实体 AABB、方块查询、父级 Molang 变量、资源 generation 和 owner。

基础 Port 尽量不要直接暴露 Forge/Minecraft 私有类型，可以由 eyelib 提供自己的只读运行时接口，再由 Forge 适配层实现。

## 配置和资源加载边界

YesSteveVFX 的资源放在 `config/yesstevevfx/`。eyelib 的默认 `BrParticleLoader` 只扫描 `assets/eyelib/particles/*.json`，因此不要要求 eyelib 直接扫描 YesSteveVFX 的配置目录。

YesSteveVFX 应负责扫描、校验和解析配置，在客户端线程调用 definition Port，负责图片解码和纹理上传，并用 `sourceKey` 做一次原子替换。后续 YSM 提供通用容器时，容器读取结果也应转换为同一个 `replaceDefinitions(...)` 调用。

## 线程和生命周期要求

- JSON、图片和 Molang 解析可以在后台线程执行。
- 注册表替换、纹理/GPU 资源创建和释放必须回到客户端线程。
- `spawn/updatePose/remove` 的调用线程要么固定为客户端线程，要么由 Port 自己排队。
- `sourceKey` 的替换必须是原子的。
- 旧 generation 被实例引用时不能立即释放。
- 世界切换、断开连接和客户端登出时必须清理实例。
- `clearOwned(ownerId)` 要能一次清理 YesSteveVFX 创建的所有实例。

## YesSteveVFX 的依赖边界

YesSteveVFX 只依赖稳定的 `particle.api` Port、粒子 JSON schema 和明确的版本/线程契约。

不要让 YesSteveVFX 直接依赖 `ParticleRenderManager`、`ParticleRuntimeBridge` singleton 细节、`BedrockParticleRenderer`、Mixin 类、eyelib 内部 Molang evaluator 或 Forge 私有渲染实现。

YSM 负责 Molang 和动画指令帧；YesSteveVFX 负责特效实例、slot、实体/骨骼锚点和生命周期；eyelib 负责 Bedrock 粒子求值和绘制。

## 版本发布要求

请把 Port 视为公开 API，并固定 Maven 坐标、Minecraft/Forge 版本、Java 版本、包名、API 方法签名、线程契约和资源 schema 版本。建议发布一个明确的新版本，例如 `eyelib 1.20.1-forge-port-1`，并提供与该版本完全一致的源码、JAR 和简单示例。

当前 README 坐标对应的旧构件使用 `io.github.tt432.eyelibparticle.*`，而当前源码使用 `io.github.tt432.eyelib.*`，两者不能混用。发布前需要先解决构建脚本的 `JvmVendorSpec.IBM_SEMERU` 配置兼容问题，并用干净环境完成 `compileJava` 和示例 Mod 编译。

## 最小验收标准

- 能加载一个 Bedrock 粒子 JSON 并原子替换。
- `spawn -> updatePose -> remove` 生命周期完整。
- 同一个 `spawnId` 的重复行为有明确规则。
- 可按 `ownerId` 批量清理。
- 客户端 reload 后旧 generation 不再渲染。
- 远端实体不再错误使用本地玩家 AABB。
- 客户端线程和后台线程调用都有明确处理。
- 独立示例 Mod 只引用 `particle.api` 就能运行。
- Maven 构件中的包名、方法签名和仓库源码完全一致。

## 可以直接发给朋友的话

现有 eyelib 的 Bedrock 粒子核心已经够用了，不需要重写。现在缺的是一个稳定的第三方接入层。请把 `ParticleSpawnRuntimeAdapter` 和 `ParticleResourcePublication` 包装成 `particle.api` 下的公共 Facade，`ParticlePort` 只返回接口，不返回具体 Adapter；同时补充资源原子替换、owner 清理、线程契约和可选运行时上下文。第一版上下文可以简单，先支持 `spawn/updatePose/remove`，由 YesSteveVFX 自己维护实体和骨骼位姿。后续再补世界、实体 AABB 和父 Molang scope。请把这套 API 固定成一个新的 1.20.1 Forge Maven 版本，并保证发布 JAR 和当前源码的包名/API 一致。我们会让 YSM 负责动画指令和 Molang，YesSteveVFX 负责特效实例，eyelib 只负责 Bedrock 粒子运行和渲染。
