# 原地播放（2026-10-08）

新增 `ctrl.vfx_play_fixed(effect_id, slot)` 与 `/vfx_client play_fixed <effect> <slot>`。
调用时仅捕获不可变位置/旋转数据，客户端 tick 安全创建固定载体；生命周期和 slot 复用既有运行时。默认跟随播放保持原语义，包结构无需修改。

第 0 帧触发记录动作起点，后续帧触发记录该帧位置；不倒查动画起点，不读取模型骨骼 Root 的视觉偏移。模型动画与粒子局部/世界空间运动照常运行。世界切换、reload 清空待执行快照。

Blockbench 资产与绑定加入两种播放语句及复制按钮。

## 本轮上游同步

- eyelib-upstream：486b68c0 → 14468212，快进 master；新增 bbmodel 内嵌动画双重翻转修复（21.1.19）与编译 CI。
- YesSteveSkill-Daniel：合入 TT432/yessteveskill 的 f8320d6，修复重力倍率 0 的滞空及双端同步，保留本地公开命中/战斗接口；未改动未跟踪的根运动审计文档。
- 本轮客户端只更新 VFX，eyelib/YSS 新源码未构建部署；避免改变已验证的依赖组合。YSS 上游修改了网络包布局，后续部署时需客户端和服务端使用同一版本。

## 手动验收

1. 重启客户端后 reload，使用原地播放命令，立刻移动/转身，确认出生点和载体方向固定。
2. YSM 第 0 帧原地播放后执行高速 Root 位移，观察模型与粒子留在起点，自身动画照常。
3. 用不同 slot 同时原地/跟随播放，确认互不影响；同 slot 替换，stop/set 正常。
4. 特效到期、reload、退出世界后清理，不将旧快照带入新世界。

自动测试覆盖队列快照、指令顺序、容量与清理以及插件语句生成；游戏内视觉效果待用户验收。

## 验证与部署

VFX `test build` 成功（包含 YSM、eyelib 桥接），18 项 Java 测试通过；Blockbench 40 项 Node 测试通过，插件已通过 3000 端口 MCP 重载并确认菜单注册。
客户端已部署 `ysm-vfx-1.0.0-pre.2-fixed.1.jar`，旧 JAR 备份在 `build/client-backups/fixed-play-20261008-020141` 并禁用。SHA-256：`6D12A27B4FBB73A270A314B7FFE0A25EFA0D115971E9AA479D39F8B644F766CF`。需要完整重启 Minecraft；尚未进行游戏内视觉验收。
