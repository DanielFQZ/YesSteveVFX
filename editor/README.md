# YesSteveVFX Web 编辑器

这是一个不依赖构建工具的静态编辑器原型。它使用浏览器的 File System Access API，把导入的资源写入用户明确选择的 Minecraft 客户端目录。

## 启动

在仓库根目录执行：

```powershell
python -m http.server 8080 -d editor
```

然后打开 <http://localhost:8080>。Chrome 和 Edge 支持目录写入；不要直接双击 `index.html`，因为浏览器通常会禁止本地文件页面申请目录写入权限。

## 使用

1. 点击“选择 .minecraft 目录”，选择客户端的根目录。编辑器会扫描 `versions/`；检测到多个版本时，必须在“写入版本”下拉框中确认目标版本，避免把资源写入错误的实例。
2. 填写 `pack_id`、显示名称和持续时间。Effect 名称只在没有动画时作为备用名称。
3. 把 Blockbench 导出的 `.geo.json`、`.animation.json`、粒子 JSON、render controller 和纹理拖进导入区，也可以选择一个完整资源目录。导入完成后页面会显示成功状态和文件数量。
4. 编辑器会解析所有 `.animation.json` 的 `animations` 键，把每个动画列出来。取消不需要的动画，并为需要的动画修改 Effect 名称；同一批导入资源可以一次生成多个 effect。
5. 导入粒子 JSON 后，编辑器会列出每个粒子的贴图引用。默认会读取 JSON 中的 `basic_render_parameters.texture`；如果它是旧的相对路径，工具会按文件名或包含 `particle` 的纹理自动匹配。需要时可以在界面中手动选择已导入的 PNG。粒子序列帧 PNG 即使和粒子 JSON 放在同一个目录，也会被写入 `assets/eyelib/textures/`，这样运行时才能发布这张贴图。
6. 如果动画的 `particle_effects` 使用了 Blockbench 生成的数字事件名（例如 `12`、`2`、`3`），编辑器会自动把这些事件名补到生成的 client entity 的 `particle_effects` 映射中，并按粒子文件的稳定顺序关联资源。已有的文件名事件名会优先保留。
7. 点击“保存到客户端”。编辑器会创建 `config/yesstevevfx/packs/<pack_id>/`，补齐 manifest、effect 和缺少的 client entity/render controller，并报告写入的版本、文件数和 effect ID。
8. 在游戏中执行 `/vfx_client reload`，再使用生成的 effect ID 播放。

完整的 Molang 指令帧规范见 [`../docs/MOLANG-REFERENCE.md`](../docs/MOLANG-REFERENCE.md)。

这是编辑器的第一版：它适合生成常用的单模型/单动画/粒子 effect 包。已有完整 pack 的 manifest 和 client entity 会被保留；复杂的多 entity 关系、材质变量和动画 controller 仍应直接在资源文件中编辑。
