# 音效测试版使用说明

适用版本：`1.0.0-pre.2-audio.1`，Forge 1.20.1。安装新 JAR 后完整重启 Minecraft。音效使用原版声音系统，受“主音量”和“玩家”音量影响，不要求更换 eyelib。

## 先用示例确认声音

`examples/vfx_audio_demo` 是独立纯音效包，放到当前版本目录的 `config/yesstevevfx/packs/`。部署时已复制到指定测试客户端。示例声音由程序合成，是约 0.45 秒的下降提示音，不是正式技能音效。

```text
/vfx_client reload
/vfx_client sound play yesstevevfx:vfx_audio_demo/slash swing
/vfx_client sound stop swing
```

等待 reload 报告完成后播放；日志会报告加载的视觉特效和音效数量。新资源 ID 支持命令补全。

## YSM 动画指令帧

在 Blockbench 的 **动画效果 → 指令** 中填写：

```molang
ctrl.vfx_sound_play('yesstevevfx:vfx_audio_demo/slash', 'swing');
```

需要提前停止时，在另一帧写 `ctrl.vfx_sound_stop('swing');`。短声音会自然结束，无须每次填写 stop。可以和 `ctrl.vfx_play(...)` 放在同一帧，两者互不依赖。

同一实体、同一声音槽位再次 play 会替换旧声；不同槽位/实体可以叠加。slot 用 1–64 位字母、数字、下划线、点或短横线。声音槽位和视觉特效槽位彼此独立。返回 1 仅表示进入队列，不保证设备已发声。指令必须位于 YSM 实际执行的动画中；它不因 Blockbench 普通动画预览而自动执行。

上述指令是本地客户端触发，不广播施法。命中自动播放使用单独的 `hit_bindings`，由带有 `YssHitResolvedEvent` 的 YSS fork 在服务端确认后广播；旁观者需要安装 VFX 并加载同名音效绑定才能听到。没有该 YSS 事件时，普通 Molang 音效仍可用，命中绑定不会误触发。

## 在 VFX 插件中导入自己的音频

1. 打开/新建特效包，选择 **VFX → 音效管理**（或资产与绑定中的音效入口）。
2. 点击 **导入 OGG**。支持单声道 OGG Vorbis、8–96 kHz、最长 10 秒、每文件最大 4 MiB。不支持仅改扩展名的 WAV/MP3；立体声请先用音频软件导出为单声道。
3. 修改音效 ID、音量、音高、距离和跟随，点击 **保存音效配置**。关闭窗口不会自动保存字段修改。
4. 点击试听检查内容；点击复制播放/停止指令，粘贴到 YSM 动画指令帧。
5. 客户端目录内的包直接 reload；外部工程使用现有 **导出到客户端** 功能后 reload。

导入会把音频复制到包内 `assets/yesstevevfx/sounds/`，保留中文文件名。同名同内容复用；同名不同内容增加 `_2` 等数字，不覆盖原文件。逻辑音效 ID 使用 `yesstevevfx:包名/音效名`，仅小写英文、数字、`_ . / -`，不允许 `..` 和空路径段；改 ID 后需要更新指令。

试听只验证音频内容、音量和音高；空间衰减与实体跟随要在游戏中测试。移除定义不会删除原 OGG。已有命中绑定引用某个音效时，须一并删除或修改绑定才能保存。

## 配置文件

包根目录 `audio.json`：

```json
{
  "format_version": 1,
  "sounds": {
    "yesstevevfx:combat/slash": {
      "file": "assets/yesstevevfx/sounds/挥刀.ogg",
      "volume": 1,
      "pitch": 1,
      "range": 24,
      "follow": true
    }
  },
  "hit_bindings": []
}
```

volume 为 0–1，pitch 为 0.5–2，range 为 1–64 格（小数向上取整，用原版线性衰减）；follow 为 true 时跟随实体，false 时在开始播放的位置播完。默认分别为 1、1、24、false。音效包可使用 `effects: []`，无需模型。

重载会暂停接受声音请求并停止当前 VFX 声音；声音资源重载也会重启原版声音引擎，因此其他正在播放的声音可能中断。配置失败保留上一份可用索引，具体错误看 `latest.log`。全局最多 32 个活动声音、每实体 8 个，超限淘汰最早实例；离开世界清理声音及排队请求。

## 本轮人工测试

- 命令听到示例声；YSM 第一/第三人称技能动画在指定帧响起。
- 同槽替换、不同槽叠加、提前 stop；循环动画是否按预期重复。
- 跟随移动、距离衰减、玩家音量滑块、暂停恢复。
- reload、换维度、退出重进后仍能正常播放，旧声音不残留。
- 原有模型和粒子效果回归。

自动检查已覆盖包解析、OGG 原生解码、错误输入、排队会话及编辑器导入导出。实际发声、方向、时序以游戏测试为准。YSS 自动命中声需要服务端和客户端都安装带事件桥的 YSS/VFX；编辑器中的命中绑定会直接参与客户端 selector 匹配。
