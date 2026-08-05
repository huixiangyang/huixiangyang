# Profile artifact generator

个人主页的动态视觉由 `generate-profile.mjs` 统一生成。生成器只读取公开 GitHub 数据，不读取或展示私有仓库名称、提交内容或其他敏感信息。

## Data sources

- REST Events API：最近 90 天公开事件、最新公开 Push、仓库名称和 Commit SHA。
- GraphQL Contribution Calendar：最近 365 天公开贡献数量与日期分布。

## Generated assets

每个模块都生成独立的明暗主题版本：

- `profile-signal-*.svg`：14 天活动波形与每日工程原则。
- `contribution-terrain-*.svg`：365 天贡献地形与 Commit 指纹印章。
- `black-box-*.svg`：隐藏式最新公开源信号读数。

Commit 指纹、径向刻度和 Black Box 条形编码均由最新公开 Commit SHA 确定，同一个 SHA 会稳定生成同一组几何结构。

## Local generation

```bash
GITHUB_TOKEN="$(gh auth token)" node scripts/generate-profile.mjs
```

生成后应执行：

```bash
node --check scripts/generate-profile.mjs
xmllint --noout assets/*.svg
git diff --check
```

## Automation

`.github/workflows/profile-artifacts.yml` 每天北京时间 09:17 执行一次。只有 SVG 内容发生变化时才会提交，生成权限仅包含仓库内容写入。
