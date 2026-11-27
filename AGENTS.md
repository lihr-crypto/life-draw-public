# Life Draw

改动前读取 [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md)。本期功能与接口以 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) 和 `app/contracts.ts` 为准。

接续本轮开发先读 [docs/HANDOFF.md](docs/HANDOFF.md)，以其中的实际验证边界和待修视觉偏差为起点。

- 抽签前和等待中只返回身份与状态；词只在服务端共同揭晓后出现。灵感管理页可以主动查看词。
- 两个成员的最终选择保持一致；所有抽取、揭晓与完成操作支持重复请求和并发。
- 运行数据、用户照片与转录、配对凭据、QA 身份和截图留在忽略目录；提交可移植源码与合成样例。
- 保留 Sites starter 的构建和身份集成；本地设备身份只用于 loopback 开发，不能进入线上匿名认证路径。
- 核验实际功能再报告完成，分别说明自动检查、双浏览器检查、云端及真机证据。
