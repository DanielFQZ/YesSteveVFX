# 利用 eyelib 现有光照能力

- 目标：插件提供按特效的模型全亮选项、按粒子资源的环境光选项，供游戏内对比。
- 模型：写入对应 render controller 的 ignore_lighting；不替换材质、不更改 eyelib。
- 粒子：保留源文件设置为默认，可覆盖为接受环境光或全亮；只改变生成副本中 particle_appearance_lighting 组件是否存在。
- 工程保存、重新扫描、运行时导出后再导入均保留实际光照语义。共享粒子使用同一设置，不按动画重复生成冲突资源。
- 不变量：不开启选项时保留现有行为；不修改源粒子 JSON；不把全亮描述为 Bloom、禁止投影或保证光影下无阴影。
- 验证：Node 测试覆盖开关、非法配置、持久化及往返导出；通过 Blockbench MCP 热重载并检查真实界面和保存结果。
- 不改模组 JAR；最终光影与无光影视觉差异由用户在游戏中实测。

## 模型全亮无效的运行时排查

- 客户端控制器 ignoreLighting=true，但播放后的 ModelComponent 为 ignoreLighting=false、minecraft:entity_translucent。
- 根因：导出 materials 使用字符串数组，被 eyelib 解码为空绑定，进入 fallback ModelComponent，不继承控制器全亮。
- 修复所有导出入口为 [{"*":"Material.default"}]，显式选择 entity_translucent 保留原实际半透明行为；源和客户端已导出控制器须备份后修复。
- 回归：配置结构测试外，运行中客户端 reload 后创建测试实例，确认真实组件 ignoreLighting=true；测试实例在检查后立即停止。
