# 命中检测区间方案

YesSteveVFX 的命中特效和命中音效可以与 Camera 共用同一套 YSS 确认命中
语义：YSM 指令帧负责武装/关闭窗口，YSS 负责确认真实命中，VFX 在客户端
按窗口内容选择音效和特效。

建议指令：

```molang
ctrl.vfx_hit_begin('attack_hit', 'yesstevevfx:new_test_pack/attack1', 'new_test_pack:test1', 'hit_fx');
ctrl.vfx_hit_end('attack_hit');
```

参数依次为监测 slot、音效 ID、特效 ID 和命中特效 slot。上面的 ID 是当前测试包中的实际示例，必须替换成已经在客户端加载的音效和特效 ID。音效或特效可以为空字符串，表示本次只播放另一种表现。ID 只从本地已加载资源中解析。一次函数调用必须在一个 YSM 指令帧字符串中保持为一整行。

窗口状态按来源实体 UUID 和 slot 保存，跨世界、死亡、reload 时清理；收到
YSS 命中 sequence 后去重。窗口存在时覆盖 `audio.json` 的旧
`hit_bindings`；没有窗口时保留旧绑定作为兼容回退。这样旧包仍能工作，新
动画可以把选择关系放回 Molang 指令帧，不需要为每个 YSM 模型建立静态映射。

实现需要修改 VFX 的 YSM bridge、客户端命中状态、音频命中入口和命中特效
播放入口。YSS 的确认命中事件和现有网络包可以复用，不需要 VFX 重新计算
碰撞。Blockbench 插件应提供成对的“开始命中检测/结束命中检测”指令帧，
并从已加载的音效和特效列表生成 ID。

当前接口原型为 `ctrl.vfx_hit_begin(slot, sound_id, effect_id, effect_slot)`
和 `ctrl.vfx_hit_end(slot)`。空的 sound/effect 参数表示只启用另一种表现。
