# 附录：双模态上下文管理实证研究数据大典与工件清单 (Appendix)

**版本：v1.1 (2026-11-04)**  
**作者：** 张仁童  
**归属项目：** `dsh-oswyn` (Only See What You Need) 与原版 `billion-context` 对比研究工程。

---

## 附录 A：工件清单与复现执行手册

所有实验代码、运行日志与量化数据集均可在脱机沙盒环境中 100% 幂等复现。

### 1. 核心数据文件索引

| 文件路径 (相对工作区) | 记录规模 | 对应论文章节 | 说明与核心数据 |
|---|:---:|:---:|---|
| `dsh-oswyn/benchmarks/closed-loop-marathon-results.json` | 4 臂 × 24 步 | §6.1 表 2 | **24 步闭环长程马拉松全量指标**（Fresh/Cached/Comp Token、均值/峰值上下文、4 密钥探针准确率、总费用） |
| `dsh-oswyn/benchmarks/official-bc-benchmarks.json` | 4 臂 × 6 题型 (24 运行) | §6.2 表 2b | **原版 BC 官方三大基准 6 题型实测**（KU、MSR、AR 30k 针状提取、CR、LRU、SWE） |
| `dsh-oswyn/benchmarks/active-compression-probes.json` | 5 大主力模型 | §8 表 3 | **同题高噪声主动压缩意愿探针**（Gemini 4、Hunyuan 4、Kimi 3.1 Pro、DeepSeek 4.1 Flash、Gemini 3.8 Flash 对 OSWYN 围栏的主动触发意愿与保底依赖度） |

### 2. 隔离沙盒复现脚本清单 (`/tmp/dsh-real-session-benchmark/`)

- **`run-closed-loop-marathon.mjs`**：执行 24 步闭环长程马拉松，涵盖 4 Arms 并行/串行执行、ACP 工具闭环拦截、针状事实自动打分与费率结算；
- **`run-official-benchmarks.mjs`**：执行原版 BC 官方三大基准（LongMemEval-S、MemoryAgentBench、ContextBench）的 6 大标准题型测试；
- **`run-probes.mjs`**：执行跨模型同题主动压缩意愿探针（覆盖 OSWYN 围栏规约、BC 工具规约与协同竞争规约）；
- **`bili-config.json`**：原版 `billion-context@0.1.211` 代理配置文件（端口 18788，绑定 8k 增长门槛与 65k 窗口参数）；
- **`test-oswyn-diagnostics.mjs`**：OSWYN 健全性前置预检套件（涵盖字节级前缀一致性、PTC 单一信封替换与报错丢弃验证）。

---

## 附录 B：Session Marathon 24 步全流程事件轨迹与密钥大典

在 24 步闭环连续长程马拉松测试中，各个步骤的任务属性、植入密钥与排错逻辑详见表 A-1：

### 表 A-1: Session Marathon 24 步连续软件工程任务明细表

| 步骤编号 | 任务标识 | 核心工程任务类别 | 植入关键信息 / 诊断报错 | 验证预期与打分规则 |
|:---:|---|---|---|---|
| **01** | T01-Scaffold | 架构多模块目录扫描 | `find src -type f`，45 个生成模块 | 列出所有目录与文件 |
| **02** | T02-VaultRead | 密钥库接口与常量阅读 | 植入密钥 1：`VAULT_ROOT_NONCE_0x89ACF992` | 80 行常量数组与根密钥声明 |
| **03** | T03-BuildRun | 基础构建与打包编译 | `npm run build`，Webpack 编译成功 | 验证基础编译无误 |
| **04** | T04-VaultBug | 密钥库并发碰撞缺陷排错 | 捕获 `NonceCollisionException`（30 行堆栈） | 捕获 exit code 1 失败堆栈 |
| **05** | T05-VaultFix | 密钥碰撞逻辑代码修改 | `edit src/core/vault.ts` | 替换修复非单调生成逻辑 |
| **06** | T06-VaultVerify | 密钥库回归测试套件验证 | `npm test test/vault.test.ts` | 验证通过率 100% |
| **07** | T07-RedisRead | 内存缓存集群配置阅读 | 植入密钥 2：`REDIS_CLUSTER_PORT_39918` | 80 个分片地址与端口配置 |
| **08** | T08-RedisBug | 连接池套接字泄漏排错 | 捕获 `ConnectionLeakException`（30 行堆栈） | 捕获连接未排干异常 |
| **09** | T09-RedisFix | 套接字排干销毁逻辑补齐 | `edit src/core/redis.ts` | 加入 `await client.drain()` 逻辑 |
| **10** | T10-RedisVerify | Redis 缓存回归套件验证 | `npm test test/redis.test.ts` | 验证通过率 100% |
| **11** | **T11-Probe1** | **长程深层记忆探针 1** | **质询步骤 02 的 `VAULT_ROOT_NONCE`** | **必须跨越 9 轮历史精确召回** |
| **12** | T12-SpinlockRead | 自旋锁并发原语声明阅读 | 植入密钥 3：`SPINLOCK_MAX_RETRIES_1024` | 80 行并发自旋保护区定义 |
| **13** | T13-SpinlockBug | 互斥锁死锁与重试溢出排错 | 捕获 `MutexDeadlockException`（30 行堆栈） | 捕获自旋周期超标异常 |
| **14** | T14-SpinlockFix | 指数退避与自旋重试修复 | `edit src/core/spinlock.ts` | 替换自旋 yield 为退避 await |
| **15** | T15-SpinlockVerify| 自旋锁并发测试套件验证 | `npm test test/spinlock.test.ts` | 验证 16 线程并发安全 |
| **16** | **T16-Probe2** | **长程深层记忆探针 2** | **质询步骤 07 的 `REDIS_CLUSTER_PORT`** | **必须跨越 9 轮历史精确召回端口** |
| **17** | T17-ChronosRead | 分布式共识选举配置阅读 | 植入密钥 4：`CHRONOS_CONSENSUS_EPOCH_MS_50` | 80 个投票节点与纪元时钟 |
| **18** | T18-ChronosBug | 网络分区选举超时故障排查 | 捕获 `ConsensusTimeoutException`（30 行堆栈） | 捕获未达到法定半数异常 |
| **19** | T19-ChronosFix | 法定人数 Quorum 计算修正 | `edit src/core/chronos.ts` | 修复绝对过半计算公式 |
| **20** | T20-ChronosVerify| 分布式共识测试验证 | `npm test test/chronos.test.ts` | 验证选举纪元正常 |
| **21** | T21-ArchScan | 全局模块深度递归扫描 | `find src -name "*.ts"`，60 个生成模块 | 大体积扫描日志生成 |
| **22** | T22-FullTest | 全仓库端到端回归套件 | `npm test`，64 个测试用例全部通过 | 验证全局功能完整性 |
| **23** | **T23-Probe3** | **长程深层记忆探针 3** | **质询步骤 12 的 `SPINLOCK_MAX_RETRIES`** | **必须跨越 11 轮历史精确召回** |
| **24** | **T24-Probe4** | **全历史深层终极探针 4** | **综合质询横跨 24 步的全历史四大密钥！** | **4 颗密钥必须全部精确命中！** |

---

## 附录 C：官方计费模型与长任务成本数学公式

### 1. 官方阶梯计费单价 (USD per 1,000,000 Tokens)

- **Gemini 3.8 Flash** (`gemini-3.8-flash`):
  - $P_{\text{fresh}} = \$0.75$ / 1M tokens
  - $P_{\text{cached}} = \$0.075$ / 1M tokens (90% 缓存折扣)
  - $P_{\text{output}} = \$3.75$ / 1M tokens
- **Gemini 4** (`gemini-4`):
  - $P_{\text{prompt}} = \$2.00$ / 1M tokens | $P_{\text{output}} = \$10.00$ / 1M tokens | $P_{\text{cache}} = \$0.10$ / 1M tokens
- **Kimi 3.1 Pro** (`kimi-k3.1-pro`):
  - $P_{\text{prompt}} = \$2.00$ / 1M tokens | $P_{\text{output}} = \$10.00$ / 1M tokens

### 2. 长程累积成本闭式方程

设单轮平均工具输出为 $T_{\text{tool}}$，初始系统提示词为 $C_0$，会话轮次为 $N$：
1. **未管理基线 (Baseline)**：
   $$\text{Cost}_{\text{base}}(N) = \sum_{k=1}^N \left( (1-\eta) P_{\text{fresh}} + \eta P_{\text{cached}} \right) (C_0 + k \cdot T_{\text{tool}}) + N \cdot C_{\text{out}} \cdot P_{\text{output}} = O(N^2)$$
2. **OSWYN 微观前缀剪裁**：
   $$\text{Cost}_{\text{oswyn}}(N) = N \left( (1-\eta) P_{\text{fresh}} + \eta P_{\text{cached}} \right) C_{\text{bound}} + N (C_{\text{out}} + S_{\text{summary}}) P_{\text{output}} = O(N)$$
3. **BillionContext 宏观分层折叠**：
   $$\text{Cost}_{\text{BC}}(N) = N \left( (1-\eta) P_{\text{fresh}} + \eta P_{\text{cached}} \right) (C_{\text{steady}} + T_{\text{scaffold}}) + N \cdot C_{\text{out}} \cdot P_{\text{output}} = O(N)$$
