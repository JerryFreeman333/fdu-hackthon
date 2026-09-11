# Real rescan integration contract

浏览器端的复扫入口采用明确文件选择，不读取、持续记录或自动上传摄像头内容。

上传接口默认为 `POST /api/route2/rescan`，由部署环境提供真正的本地/服务端 Home Twin worker。浏览器只负责：

1. 选择复扫媒体。
2. 生成 `home-twin-rescan-manifest`。
3. 通过 multipart 上传媒体和 manifest。
4. 接收 `home-twin-rescan-result`。
5. 用最新 `riskId` 集合更新家庭行动状态。

浏览器不会自行宣称环境安全。没有有效的 Home Twin result 时，上传失败只显示“未确认”，不会调用 Demo 风险结果替代真实复扫。
