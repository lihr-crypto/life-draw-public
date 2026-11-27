# GitHub workflow

新功能从 main 建立 feature 分支，完成检查后提交、推送并创建 PR。合并和发布按用户明确指令执行。

检查入口由 package.json 的 test、typecheck、build 脚本定义。数据库与双人流程还需运行本地 D1 和两个独立浏览器上下文检查。

本机开启 `.githooks`。源码使用明确文件清单暂存；个人数据、运行状态和构建产物不提交。
