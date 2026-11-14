# 05 · G1/G2 男女主人公美术素材完整交付（2026-11-14）

**实际文件已进入 GitHub Git 对象与目录树，并非只有文字清单。** 本交付保存了已确认方向的 **G2 高清插画空间候选** 与 **G1 双主人公备选造型**。此批仍为角色与家具遮挡的**评审级素材**，**不是**原生 2560×1440 的 G5 中性开局正式母图；不要据此宣布完整床、工作台及角色遮挡验收通过。

## 可直接在 GitHub 查看 / 克隆的图片

- [G2 木屋全景场景图](../../../assets/05/cabin/g2_layout_review.webp)（1672×941，WebP 预览）：此处为完整原图的预览编码，原始无损 PNG 在下面还原的 ZIP 内。
- [男女各四张完整场景合成图](full-scenes/)（共 8 张 1672×941 WebP）：`male_sleep/sitRead/sitWrite/standWork`、`female_sleep/sitRead/sitWrite/standWork`。这些文件仅作直接查看，非无损源文件。
- [男性透明角色素材](../../../assets/05/actor/indoor/male/) 与 [女性透明角色素材](../../../assets/05/actor/indoor/female/)（8 张 **原始无损 RGBA PNG**，1672×941），已直接写入仓库。

## 完整无损交接包（GitHub 35 个二进制分片）

**完整 ZIP 共 36,108,530 字节，包含 34 个文件，其中有 G2 木屋无损 PNG、8 张完整木屋合成无损 PNG、8 张原始透明 PNG、角色源裁切、人物四姿态对照 JPG、`manifest.json` 与 `qa/qa.json`。**

由于当前 GitHub 写入接口对多 MB 单次请求有限制，**完整 ZIP 并不是作为一个 `.zip` 文件存在于仓库里**，而是以 [`archive-parts/`](archive-parts/) 下 **35 个标准 Git 二进制分片**完整入库（不是占位符，不是 Git LFS 指针，也不是私有临时目录）；克隆仓库即可无损还原。每块 Git 对象 SHA-1 与大小列于 [`archive-manifest.json`](archive-manifest.json)。

在仓库根目录执行：

```bash
python3 deliverables/05/g1-g2-20261114/rebuild_archive.py
# 想顺便解压：
python3 deliverables/05/g1-g2-20261114/rebuild_archive.py --extract
```

脚本会逐块验证 Git Blob SHA-1 和字节数、拼接 ZIP、核对完整文件的 SHA-256，并运行 ZIP 的 CRC 检查；默认不覆盖不同文件。还原后可以直接拿到**真正的无损 PNG**。完整 ZIP：

- 文件名：`beyond_storm_05_G1_G2_dual_actor_locked_scene_20261114.zip`
- 字节数：**36,108,530**
- SHA-256：`250e3c57a9e52fd3289ebfe6c400b195e44066eebbe19fda58586b8355c4c838`
- 文件数量：**34**

在 macOS 上可以用 `shasum -a 256 deliverables/05/g1-g2-20261114/*.zip` 复核。所有分片与原始 ZIP 的字节级校验已在生成环境通过。

## 当前阶段和协作边界

- 场景中人物的透明 alpha 之外像素未变，确保各姿态采用相同 G2 木屋底图。
- 床褥、桌椅、炉台的前后遮挡是评审用蒙版，尚不是分离出来的正式家具前景层；料理台/工作台仍需检查人能否自然站立与转身。
- 以 05 v1.2 作为**质量与气氛目标**，G2 构图为候选；正式 G5 必须绘制真正原生 **2560×1440**、状态中性的开局母图，进行真实窗玻璃、灯光、库存等分层。
- 未修改 Claude 的 `game/`、02/03/06 设计或玩法；请在 Claude 评审完成后再合并相应美术分支。
