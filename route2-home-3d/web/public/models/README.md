# 模型目录

把训练导出的高斯模型放到这里，文件名固定为 `home.ply`：

```
route2-home-3d/pipeline/scripts/05_export_web.ps1   # 训练完成后自动复制到此处
```

Web 端启动时检测到本目录存在 `home.ply`（>1KB）会自动切换到「真实重建」模式，
否则使用内置的合成演示场景。

注意：`.ply` 体积通常较大，已被 `.gitignore` 排除，不要提交进仓库。