# 本地版本与发布

本仓库使用 Changesets 管理两个包的独立版本和内部依赖，不使用 CI 发布。

支持 Git 2.27：根目录的 `pnpm.overrides` 将 `@changesets/git` 固定为 `3.0.2`，避免使用旧 Git 不支持的 `--no-relative` 参数。安装依赖时请使用 pnpm 并保留锁文件；日后统一升级 Git 后可移除该限制。

修改需要发布的代码后，在根目录执行 `pnpm changeset`，选择受影响的包、版本级别并填写说明，将生成的 Markdown 文件和代码一起提交。若 ai-memory 的新功能依赖 ai-agent 的修改，应把两个包都列入发布计划。仅修改文档或开发工具时，可以执行 `pnpm changeset --empty` 记录无需发版。

发布前执行 `pnpm run release:status` 查看计划，再执行 `pnpm run release:version` 更新包版本、内部依赖、更新日志和锁文件。检查并提交这些文件后，执行 `pnpm run release:publish`，它会先运行本地检查、覆盖率测试和构建，再发布 npm 上尚不存在的包版本，并创建对应的 git 标签。

发布前运行 `pnpm run verify:release`，再对本次要发布的包运行 `pnpm --dir packages/ai-agent pack --pack-destination ./release-packages` 或 `pnpm --dir packages/ai-memory pack --pack-destination ./release-packages`，检查压缩包中的包名、版本、导出入口及 ESM、CommonJS 和类型声明文件。压缩包位于各包的 `release-packages/` 目录，无需提交。发布完成后执行 `git push --follow-tags` 推送提交和标签。

Changesets 根据变更记录安排版本，不会逐个比对 npm 已发布包与当前源码；修改发布代码时必须记录 changeset。
