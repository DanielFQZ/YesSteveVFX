# YesSteveVFX 1.0.0-pre.1

这是首个 1.0 预发布版本，目标是固定当前资源格式、Blockbench 工作流和 YSM 控制接口，供实际特效包制作与联调。

## 主要内容

- Forge 1.20.1 客户端运行时，支持 Bedrock 模型、动画、粒子和组合特效。
- 通过 `ctrl.vfx_play`、`ctrl.vfx_stop`、`ctrl.vfx_set` 接入 YSM Molang 指令帧。
- 通过客户端本地 carrier 跟随真实实体，切换世界、退出服务器和生命周期结束时自动清理。
- 本地资源加载器提供路径穿越、符号链接、未知字段、重复 ID 和大小预算校验。
- eyelib 集成只发布 `yesstevevfx` 命名空间资源，检测跨包资源 ID 冲突；reload 发布失败时恢复原资源快照并清理失效实例句柄。
- Blockbench Studio 支持多模型、多 geometry、完整 animation 文件、逐事件粒子绑定、外部资产同步、中文路径和可读运行时文件名。
- 静态 Web 编辑器支持版本隔离客户端目录和批量动画导入。

## 已知边界

- Oculus 光影和辉光仍不属于本预发布版本的基础验收范围；默认按关闭光影验证。
- 运行时渲染需要 eyelib。没有 eyelib 时仍可以校验和加载资源，但不会显示模型或粒子。
- 当前格式不导出声音事件、动画控制器和子粒子事件；编辑器会提示这些限制。

## 构建与验证

使用 Java 17 或更高版本构建。带实际依赖构件的验证命令：

```powershell
./gradlew.bat clean build `
  -PysmJar='D:\libs\ysm-1.20.1.jar' `
  -PeyelibJar='D:\libs\eyelib-1.20.1.jar'
```

Blockbench 插件回归测试：

```powershell
node --test blockbench/tests/studio.test.js
```
