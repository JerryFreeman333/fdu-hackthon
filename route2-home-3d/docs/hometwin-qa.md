# Route 2 Home Twin 验收清单

这份清单用于防止“3D 页面看起来能用”被误认为 Home Twin 已经完成。

## Gate 0：构建与数据完整性

- [ ] `npm ci` 成功
- [ ] `npm test` 成功
- [ ] `npm run build` 成功
- [ ] 危险点、路线、物品 ID 唯一
- [ ] 路线引用的危险点全部存在
- [ ] 所有坐标都是明确的 xyz 三元组或 `null`

## Gate 1：真实模型

输入：真实家庭拍摄素材。

通过条件：

- [ ] COLMAP 不为空
- [ ] 注册图像比例 >= 30%
- [ ] 生成 `cameras.bin` / `images.bin`
- [ ] Gaussian Splatting 训练完成
- [ ] Web 可以加载真实 `home.ply`

注意：30% 只是“不要继续”的最低门槛，不代表模型质量足够。

## Gate 2：Home Twin 语义

必须从真实数据得到至少：

- [ ] 卧室
- [ ] 走廊
- [ ] 卫生间入口
- [ ] 床
- [ ] 门
- [ ] 地毯/障碍物
- [ ] 关键物品

每个对象至少需要：

`id / category / roomId / position / confidence / source / observedAt`

## Gate 3：空间关系

系统必须能够回答：

- [ ] 这个对象在哪个房间？
- [ ] 两个对象是否相邻/接近？
- [ ] 某个障碍是否位于关键路线附近？
- [ ] 床到卫生间是否存在连续可走通道？

## Gate 4：主要生活路线

第一条只做：

`Bed -> Toilet`

通过条件：

- [ ] 路线起点/终点来自 Home Twin 对象
- [ ] 路线由空间关系产生，而不是写死一条曲线
- [ ] 路线可关联风险点
- [ ] 路线数据带 confidence

## Gate 5：真实寻物

- [ ] 记录物品最后已知位置
- [ ] 记录更新时间
- [ ] 记录位置可信度
- [ ] 位置不确定时明确告诉用户“不确定”
- [ ] 不把预置 Demo 位置冒充真实扫描结果

## Gate 6：环境变化

第二次扫描后至少验证一个变化：

- [ ] 新增障碍
- [ ] 移除障碍
- [ ] 家具移动
- [ ] 常用物品位置变化

并输出：

`oldVersion -> newVersion`

以及受影响的路线/风险。

## Gate 7：人工校正

黑客松阶段允许人工确认，但必须显式记录：

- [ ] 谁/什么来源完成校正
- [ ] 校正前结果
- [ ] 校正后结果
- [ ] 校正时间

## Gate 8：Person × Home 接口

Route 2 最终向 Route 1 输出结构化 Home Twin 数据，而不是只输出 PLY：

```json
{
  "homeId": "home-001",
  "version": 7,
  "route": "bed-to-toilet",
  "hazards": [
    {
      "type": "rug",
      "position": [0, 0, 0],
      "confidence": 0.93
    }
  ]
}
```

Route 2 不直接诊断疾病；个体化风险由后续 Person × Home / Risk Engine 负责。

## 红线

以下任一情况都不能在演示中宣称“已经完成 Home Twin”：

1. 只有 PLY，没有结构化对象数据。
2. 危险点完全来自静态 JSON，没有真实视觉来源。
3. 真实路线没有空间标定却显示成确定导航路线。
4. 没有 confidence / source / observedAt，却把空间结果当事实。
5. 真实模型加载后通过报错/回退到 Demo 来掩盖缺失能力。