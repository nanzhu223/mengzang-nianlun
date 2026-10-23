# 汇文明朝体（子集）

`huiwen-mincho-subset.woff2` 只保留了首页 3D 院落里三块导航牌用到的 11 个字：
人、物、长、廊、史、料、库、关、于、我、们。约 6.5 KB。

- 原字体：汇文明朝体（Huiwen Mincho），作者：特里王
- 来源：<https://github.com/bosswnx/huiwenmincho-improved>（release 20241203）
- 授权：作者声明该字体可免费用于印刷、显示、网页嵌入与设备；可自由转发，
  不可单独作为字体产品销售。本项目仅嵌入上述子集用于页面标题牌。
- 生成方式：`pyftsubset`（fontTools），`--flavor=woff2 --layout-features="" --no-hinting`

页面上 `@font-face` 优先使用本机安装的「汇文明朝体」，没有时回落到这个子集文件。
若以后牌子上要加字，需要重新取子集并把新字加进来。
