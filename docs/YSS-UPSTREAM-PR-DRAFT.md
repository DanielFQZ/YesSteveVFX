# YSS 上游 PR 草案（等待游戏测试）

本文件记录 `DanielFQZ/yessteveskill` fork 当前相对上游的接口改动。它暂时只是审计和测试清单，未向上游仓库发送 PR。

## 当前 fork 改动

`1bb76f9 feat: publish confirmed hit event for companions` 在服务端命中处理确认伤害段返回成功后发布 `YssHitResolvedEvent`。事件是非可取消 Forge 事件，字段为：

- `ServerPlayer attacker()`：攻击者；
- `LivingEntity target()`：命中的实体；
- `String modelId()`：YSM 当前模型的公开模型 ID；
- `String animation()`：YSM 动画名；
- `int segmentIndex()`：YSS 判定段的零基下标；
- `Vec3 position()`：命中目标包围盒中心的不可变快照。

事件在即时伤害和延迟执行路径的确认命中处发布，只有正伤害段实际接受伤害时触发。它不表示目标一定损失生命值（例如吸收盾仍可能接受伤害），也不负责网络广播。

## VFX 当前使用方式

YesSteveVFX 通过可选反射桥接监听这个事件，因此没有安装 YSS 时仍可正常加载和播放普通特效/音效。命中事件由 VFX 服务端桥转换成客户端数据包，客户端按照 `audio.json` 的 `model_id + animation + segment_index` 精确匹配声音；声音资源和路径仍由客户端包控制，YSS 不读取或接受客户端资源路径。

## 向上游提交前需要确认

1. 在实际技能、多人和延迟命中场景中确认事件只发布一次，且即时与延迟路径字段一致。
2. 确认 `modelId` 的含义长期保持为 YSM 对外模型 ID，而不是文件夹名或 geometry identifier。
3. 确认事件发布位置覆盖纯伤害、击退、击飞和连击段，不受后续 `return` 分支影响。
4. 确认事件类的包名、访问修饰符和字段命名适合第三方模组依赖，并决定是否补充事件版本/序列号。
5. 测试通过后再从 fork 向上游提交只包含事件 API 和发布点的最小 PR；VFX 的反射适配器、音频协议和编辑器不应放进 YSS PR。

## 当前验证结果

- fork 已推送到 `https://github.com/DanielFQZ/yessteveskill` 的 `master`；
- `gradlew build` 通过；
- VFX 反射桥和客户端音频解析测试通过；
- 游戏内的多人、延迟出伤和多目标重复命中仍需用户实测后，才能决定是否发送上游 PR。
