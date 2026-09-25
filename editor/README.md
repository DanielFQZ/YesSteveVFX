# YesSteveVFX Web 编辑器

这是一个不依赖构建工具的静态编辑器原型。它使用浏览器的 File System Access API，把导入的资源写入用户明确选择的 Minecraft 客户端目录。

## 启动

在仓库根目录执行：

```powershell
python -m http.server 8080 -d editor
```

然后打开 <http://localhost:8080>。Chrome 和 Edge 支持目录写入；不要直接双击 `index.html`，因为浏览器通常会禁止本地文件页面申请目录写入权限。

## 使用

1. 点击“选择 .minecraft 目录”，选择测试客户端的根目录。
2. 填写 `pack_id`、显示名称、effect 名称和持续时间。
3. 把 Blockbench 导出的 `.geo.json`、`.animation.json`、粒子 JSON、render controller 和纹理拖进导入区，也可以选择一个完整资源目录。
4. 点击“保存到客户端”。编辑器会创建 `config/yesstevevfx/packs/<pack_id>/`，补齐 manifest、effect 和缺少的 client entity/render controller。
5. 在游戏中执行 `/vfx_client reload`，再使用生成的 effect ID 播放。

完整的 Molang 指令帧规范见 [`../docs/MOLANG-REFERENCE.md`](../docs/MOLANG-REFERENCE.md)。

这是编辑器的第一版：它适合生成常用的单模型/单动画/粒子 effect 包。已有完整 pack 的 manifest 和 client entity 会被保留；复杂的多 entity 关系、材质变量和动画 controller 仍应直接在资源文件中编辑。
