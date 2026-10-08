# xin_vfx 相机朝向与 Molang 排查（2026-10-08）

## 当前交付与验证边界

用户确认上次 a4 爆炸俯仰修复有效，但两道斩击在角色正面/背面观察时表现不一致。本次提供资产侧的屏幕平行斩击调整版，并修正 a3 的两处同类俯仰公式。已同步源包、源包生成文件和客户端文件；没有修改或替换任何模组 JAR。

这次改变了斩击原先的固定空间倾角，不是保持原造型完全一致的渲染器补丁。数学验证已通过，尚未在用户的实际游戏视角中确认最终画面，不能据此宣称已定位或排除所有渲染问题。

## 已确认的事实

- a4 的两道斩击是模型薄片，不是 Bedrock 粒子；父节点原来使用固定欧拉角，没有相机查询。
- 斩击 cube 尺寸 240×260×0.2，自身另有 -90° X 轴旋转；子骨骼 Y 轴关键帧负责平面内的扫动。
- 原始左右主面法线在角色 yaw=0 时约为 (0.1828,0.9577,-0.2223)、(0.2329,0.9092,-0.3451)，接近水平面，不能在不同观察方向保持同样的投影面积。
- 已检查客户端实际 eyelib-21.1.16+1.20.1-forge.jar 的 TextureColorMaterial 字节码：texture_unlit 使用 CullStateShard(false)，半透明不写深度。源码片元着色器也没有基于 gl_FrontFacing 的丢弃。仅凭背面 UV 透明，不能判断是背面剔除。
- 未发现当前渲染路径对普通模型逐面执行 CPU 背面剔除的代码；客户端未安装 AcceleratedRendering。以上属于代码与配置检查，不能代替 GPU 帧捕获。
- 资产中的模型骨骼、贴图和动画引用完整，源与导出内容一致；a4 动画 2.1 秒、特效时长 62 tick，不是生命周期提前结束。
- 没有足够证据将用户观察到的全部缺失归因于 eyelib 或 VFX 的代码缺陷。

## 斩击调整

仅替换 a4 的 ysmGlow_SwordBleft1、ysmGlow_SwordBright1.rotation：

```text
X: 90 - query.camera_rotation(0)
Y: query.camera_rotation(1) + 180 - query.body_y_rotation
Z: 0
```

这里的 90 用于补偿内部 cube 的 -90° X 轴旋转；不能直接照搬爆炸平面的负 pitch 公式。保留两道斩击的位置、缩放、出现/消失时间、子骨骼的左右扫动与序列帧。

验证包括角色 yaw、相机 yaw/pitch（含正负 90°）、左右扫动角度，以及右斩击非均匀缩放。通过实际两个面切向量的叉积计算法线，共 3,780 组组合，法线与屏幕法线点积绝对值距离 1 的最大误差为 4.45e-16 以内。

屏幕平行解决的是平面方向，不会绕过地面/墙壁遮挡，也不会将视野外或镜头背后的组件移入画面。若仍出现缺失，应对比具体帧的相机位置、深度与裁剪，不能继续无依据地修改 Molang。

## 其他动画审计

| 动画 | 发现与处理 |
| --- | --- |
| a1 | 没有 Molang 表达式；保留原文件内容。 |
| a2 | 使用 math.random 与 v.* 变量，没有相机查询；150 个引用变量均找到赋值。未发现不支持的函数名，但变量求值有下述风险。 |
| a3 | ysmGlow_BoomB、ysmGlow_FireBoom 使用正的 camera_rotation(0)，已改成负号；祖先 ROOOT/Skill 没有附加旋转。另有与 a2 同类随机变量。 |
| a4 | 保留用户已确认有效的爆炸负 pitch 修复，新增两道斩击的方向调整。 |

### a2/a3 随机变量的风险

RedBlock.rotation 的表达式设置随机范围，各 RedBlock 子节点的 position 关键帧执行 math.random 并写入变量，后续 position/scale 再引用这些变量。所有引用都能找到赋值，但这不意味着运行时一定先赋值后读取。

骨骼动画表达式是采样时求值，并非“只到达这一帧时执行一次”的事件。eyelib 的骨骼动画使用整数哈希映射遍历，不能依赖 JSON 中父骨骼写在前面的顺序。因此这类写法可能重复抽样，首帧也可能先读到尚未初始化的范围值。这是与 a4 消失无关的独立风险；尚未实测确认它造成了可见故障，本次未改动。后续若发现碎块跳变或首帧尺寸异常，应将初始化移到明确的动画/实例初始化阶段，再让姿态通道只读取变量。

## 文件与备份

源包：C:/Users/38683/Downloads/xin_vfx

客户端：E:/Games/YSM拍摄端/.minecraft/versions/1.20.1-Forge_47.4.16/config/yesstevevfx/packs/xin_vfx

本次修改 5 个文件：

- 源 animations/xin_vfx.animation.json（仅 a3、a4 共四个 rotation 数组）。
- 源 animations/vfx_generated/xin_vfx/a3.animation.json、a4.animation.json。
- 客户端 animations/xin_vfx/a3.animation.json、a4.animation.json。

备份位于仓库外部于包体的 build/client-backups/xin-vfx-billboard-20261008-054044；changes.json 保存原路径、备份路径、修改前后 SHA256 和数学检查结果。上一轮爆炸修复的备份仍在 build/client-backups/xin-vfx-a4-20261008-052256。

JSON 解析比较确认改动范围限于上述四个 rotation，源/生成/客户端对应动画一致，a1/a2 内容不变。验证和部署脚本保存在 build/xin_vfx_billboard_check.py，供本次测试追溯使用。

## 游戏复测

```text
/vfx_client reload
/vfx_client play xin_vfx:a4 a4_check
/vfx_client play xin_vfx:a3 a3_check
```

分别从角色正面、背面、侧面、俯视/仰视观察。注意 a4 斩击位于约 0.3–0.8 秒、0.8–1.3 秒；不要只观察后半段爆炸。无需重启客户端。若 Blockbench 已打开旧动画，重新打开磁盘文件后再编辑，避免保存内存中的旧版本覆盖修复。
