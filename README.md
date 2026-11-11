# DSH-OSWYN: Only See What You Need

### DeepSeek Harness 原生步边界内联上下文微蒸馏与推理增强引擎 (v2.1)

[![Version](https://img.shields.io/badge/version-2.1.1-blue.svg)](https://www.npmjs.com/package/dsh-oswyn)
[![npm](https://img.shields.io/npm/v/dsh-oswyn.svg)](https://www.npmjs.com/package/dsh-oswyn)
[![Tests](https://img.shields.io/badge/unit_tests-163_passed_%28100%25%29-brightgreen.svg)](test)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DeepSeek_Harness_Native-orange.svg)](https://github.com/deepseek-ai)
[![Paper (ZH)](https://img.shields.io/badge/paper_(zh)-oswyn--paper.md-purple.svg)](paper/oswyn-paper.md)
[![Paper (EN)](https://img.shields.io/badge/paper_(en)-oswyn--paper--en.md-indigo.svg)](paper/oswyn-paper-en.md)

---

> 📚 **学术论文与基准数据集指引（Research Paper & Benchmarks）**
> - **中文学术论文（理论推导、架构哲学、5 款模型官方 API 价格审计与实证分析）**：[**`paper/oswyn-paper.md`**](paper/oswyn-paper.md)
> - **Academic Research Paper (English Version)**: [**`paper/oswyn-paper-en.md`**](paper/oswyn-paper-en.md)
> - **180+ 组完整评测数据集与自动化脚本**：[`paper/data/`](paper/data/) 及 [`paper/scripts/`](paper/scripts/)
>
> *注：本 README 聚焦于工程架构、核心原语、快速上手与生产配置。完整的数学推导、理论假说、消融实验与基准评测请参阅上述论文。*

---

## 💡 核心价值（Key Value Propositions）

在自主软件工程（SWE）长程多步代理中，工具输出、错误堆栈与构建日志的二次方堆积是制约智能体生产落地的关键瓶颈。**DSH-OSWYN (Only See What You Need)** 依托步边界内联微蒸馏，实现了三大核心突破：

1. 💰 **大幅降低 Token 计费**：长程会话稳态运行账单平均压降 **65.4%**。彻底规避传统外部代理折叠造成的 KV-Cache 前缀击穿（全价未命中 Token 同步降低 `-5.2%`）。
2. 📈 **有效扩充上下文容量**：单步感知载荷净压缩率达 **72.7%**，将多步工作记忆持续锚定在 600–800 Tokens 的极高信噪比窗口，使有限上下文能够承载数倍于以往的长程交互轮次。
3. 🧠 **直接强化复杂推理能力（降噪护智）**：彻底清除早期试错与冗余输出引发的“注意力稀释（Lost-in-the-Middle）”。在虚拟机状态追踪（B₁）中准确率从基线 66.7% 跃升至 **100%**，常规工程任务达成 **100% (30/30)** 满分通过，并在 3-SAT 组合约束求解（B₁₇）中将推导耗时缩短 **47.4%（提速 1.9 倍）**。

---

## 🏛️ 核心架构与原语机制（Architecture & Primitives）

OSWYN 深度下沉至智能体思考-动作的**步进边界（Step-Boundary）**，解耦了物理存储与逻辑视图：

```text
[物理事件存储层 (Immutable Event Log)]  <--- 永久保留原始无损字节流 (只追加，不修改)
                │
                │  映射投影 (Active Projection)
                ▼
[表面逻辑视图层 (Surface DAG Active Nodes)] <--- OSWYN 步边界就地微蒸馏改写
                │
                │  组装输入 (Context Assembly)
                ▼
[LLM 上行请求上下文 (Next Turn Context)]  <--- 极致轻薄、前缀完全一致 (KV-Cache 极速命中)
```

### 1. 步边界内联微蒸馏原语（`dsh-result-summary`）
模型在当前思考-动作中内联输出代码块指令，**零额外网络往返**原位就地剪裁上一步工具输出：

| 指令语法 | 作用机制 | 适用场景 | KV-Cache 保护 |
| :--- | :--- | :--- | :---: |
| **`truncate keep <N> lines\|chars`** | 从第 0 字节开始原样保留前 N 行/字符，尾部追加紧凑事实。 | 庞大目录遍历、长编译输出、超长搜索结果。 | **100% 严格保护** |
| **`replace`** | 将长篇复杂输出整体替换为结构化结论事实块（公式与算子逐字保全）。 | 单元测试通过日志、静态分析成功报告。 | 局部尾端改写 |
| **`discard`** | 级联丢弃该工具结果，并将对应工具调用的入参一并清空为 `'{}'`。 | 命令语法错误、权限拒绝、无匹配项的探测。 | 彻底清除无效噪音 |

````markdown
```dsh-result-summary
truncate keep 10 lines
FINDINGS:
- Found 14 matching TypeScript files under src/modules/
- Target entrypoint is src/modules/auth/service.ts
```
````

### 2. 助手回复双轨投影机制（`dsh-reply-summary`）
- **Web UI 视轨**：人类用户在界面中完整阅读格式良好的长篇分析与解释；
- **模型上下文视轨**：仅提取紧凑备忘注入下一轮上下文，步间上下文膨胀率直降 70%。

````markdown
人类用户您好，我对用户鉴权模块进行了深度排查……（此处省略详细长文报告）……

```dsh-reply-summary
SUMMARY:
- 诊断结论：src/auth/jwt.ts 第 84 行存在 Token 过期未刷新漏洞
- 执行动作：已重写 verifyToken() 并注入单元测试
- 下一步：准备调用 run_code 验证测试用例
```
````

### 3. 不可变事件日志与无损秒级召回（`tool_result_recall`）
所有剪裁操作仅作用于活跃的 Surface DAG 表面节点。若后续推理需要已被截断的完整历史数据，模型可直接调用原生挂载的 `tool_result_recall(call_id)`，毫秒级取回原始未截断文本，实现有损压缩与确定性事实依赖的完美统一。

### 4. 后台静默安全网（`runAllAutoPolicies`）
当模型因高负荷未主动输出围栏时，后台自动兜底介入：
- **`autoDiscardFailed`**：自动识别非零退出码与异常堆栈并执行丢弃；
- **`autoCompressTiered`**：对未声明围栏且超限（默认 4000 字符）的非保护工具按前缀截断；
- **`autoCompressPtcSubcalls`**：对程序化代码沙箱（`run_code`）多子调用聚合结果进行结构化折叠。

---

## 🚀 快速上手（Quick Start）

### 1. 安装
```bash
npm install dsh-oswyn
```

### 2. 声明式配置启用
在 DeepSeek Harness 运行时配置文件（如 `dsh.config.json` 或 `cordis.patch.yml`）中注册：
```json
{
  "plugins": {
    "dsh-oswyn": {
      "preset": "balanced",
      "nudgeEnabled": true,
      "autoDiscardFailed": true,
      "autoCompressTiered": true
    }
  }
}
```

### 3. 编程式集成
```javascript
import { Context } from '@deepseek-ai/dsh-core';
import OswynPlugin from 'dsh-oswyn';

const ctx = new Context();

// 注册 OSWYN 插件并加载平衡预设
ctx.plugin(OswynPlugin, {
  preset: 'balanced',
  replySummaryEnabled: true,
  autoCompressKeepLines: 30,
});

await ctx.start();
```

### 4. 四大预设模式（Presets）
| 预设模式 | 适用场景 | 核心策略 |
| :--- | :--- | :--- |
| **`balanced` (默认推荐)** | 通用软件工程（SWE）、日常多步排错与代码生成。 | 开启 Nudge 压力感知，保留前 30 行，开启失败调用自动丢弃，保护核心编辑工具。 |
| **`conservative`** | 关键代码审计、金融与安全敏感推导。 | 提高 Nudge 门槛至 2000 字符，保留 50 行，扩大受保护工具名单，尽可能完整保留。 |
| **`aggressive`** | 海量批处理脚本运行、数千行日志扫描任务。 | 降低 Nudge 门槛至 300 字符，仅保留前 15 行，启用激进截断。 |
| **`programmatic-tool-calling`** | 采用 `run_code` 运行 Python/Bash 的 PTC 沙箱场景。 | 启用 `autoCompressPtcSubcalls`，按子调用进行结构化折叠并保护关键返回值。 |

---

## ⚙️ 生产配置字典（Configuration Reference）

所有参数均经由 `@deepseek-ai/schemastery` 实施严格类型校验与运行时安全防御：

| 配置参数名 | 类型 | 默认值 | 作用与功能说明 |
| :--- | :---: | :---: | :--- |
| `enabled` | `boolean` | `true` | 全局总开关，控制 OSWYN 机制在所有会话中是否激活。 |
| `preset` | `string` | `'balanced'` | 运行预设模式（`balanced`, `conservative`, `aggressive`, `programmatic-tool-calling`）。 |
| `autoApply` | `boolean` | `true` | 步边界自动执行开关，自动提取并应用模型输出中的总结代码块。 |
| `replySummaryEnabled` | `boolean` | `true` | 助手回复双轨投影开关。前端显示完整 Markdown，下轮上下文仅注入紧凑备忘。 |
| `hideReplySummaryInUi` | `boolean` | `true` | UI 折叠控制。在 Web 界面对话流中将 `dsh-reply-summary` 渲染为优雅的可展开 Chip。 |
| `nudgeEnabled` | `boolean` | `true` | 单步工具压力感知开关。当工具输出过大时，在下一步决策前注入轻量截断指引。 |
| `nudgeThresholdChars` | `number` | `600` | 常规工具输出触发 Nudge 的字符门槛。 |
| `nudgeThresholdLines` | `number` | `18` | 常规工具输出触发 Nudge 的行数门槛。 |
| `nudgeErrorThresholdChars` | `number` | `400` | 失败调用触发 Nudge 的敏感字符门槛。 |
| `nudgeErrorThresholdLines` | `number` | `12` | 失败调用触发 Nudge 的敏感行数门槛。 |
| `autoCompress` | `boolean` | `false` | 全局无差别自动压缩开关（默认关闭；开启后所有超长输出均自动截断）。 |
| `autoCompressTiered` | `boolean` | `true` | **分级自动兜底安全网**：非保护名单工具，智能体未写围栏时自动按前缀截断。 |
| `autoCompressPtcSubcalls` | `boolean` | `true` | **PTC 专用沙箱聚合**：对 `run_code` 多子调用聚合结果生成按子调用的结构化摘要。 |
| `autoDiscardFailed` | `boolean` | `true` | **失败调用自动丢弃**：自动识别非零退出码与异常堆栈，下步自动清空并覆写入参。 |
| `autoDiscardTools` | `string[]` | `['validate_dsh_ui']` | 无论执行是否成功均自动清空丢弃的高频校验工具名单（支持末尾 `*` 通配符）。 |
| `autoCompressTieredProtectedTools` | `string[]` | 详见下方 | **受保护工具白名单**：严禁被自动截断的核心工具（如代码读写编辑）。 |
| `autoCompressMinChars` | `number` | `4000` | 分级兜底自动截断触发的最小字符数门槛。 |
| `autoCompressKeepLines` | `number` | `30` | 分级兜底与裸 `truncate` 指令默认保留的前缀行数。 |

> 🛡️ **默认受保护工具白名单**：
> `run_code`, `read`, `write`, `edit`, `apply_patch`, `notebook`, `read_image`, `todo_write`, `ask_user_question`, `skill`, `tool_search`, `tool_result_recall`, `oswyn_stats`, `oswyn_protect_tool`

---

## 🧪 质量工程与测试（Quality Engineering）

DSH-OSWYN 维持着严苛的工业级质量标准，内置 **163 项自动化单元与端到端测试用例**，覆盖从底层字节前缀切片、Surface DAG 活跃节点变异、退出码模糊匹配，到 Web 前端虚拟 DOM 徽标与折叠交互的每一个分支：

```bash
# 运行完整自动化测试套件
cd dsh-oswyn
npm test
```

### 测试运行结果：
```text
✔ 163 tests passed (100%)
✔ 0 tests failed
✔ duration_ms: ~9.7s
```

---

## 📂 模块结构（Project Structure）

```text
dsh-oswyn/
├── lib/                            # 生产核心运行时源码
│   ├── index.js                    # 插件总入口与生命周期管理
│   ├── config.js                   # 配置模型与 Schemastery 校验
│   ├── protocol.js                 # 步边界围栏协议定义与解析器
│   ├── core/                       # 解析、计划、标记与原语核心
│   ├── modes/                      # truncate / replace / discard / reply-summary 实现
│   ├── session/                    # Surface DAG 活跃视图与自动策略调度
│   ├── prompts/                    # P3 决策树系统指令与压力感知 Nudge
│   ├── tools/                      # recall / stats / protect 原生运行时工具
│   └── client/                     # Web 前端 UI 徽标与折叠增强组件
├── paper/                          # 学术论文与实证研究全套归档
│   ├── oswyn-paper.md              # 中文学术论文（完整理论、数学推导与实验数据）
│   ├── oswyn-paper-en.md           # 英文学术论文（Formal Academic Paper）
│   ├── figures/                    # 出版级高清矢量图表（中英双语版）
│   ├── scripts/                    # 自动化端到端实证评测脚本
│   └── data/                       # 180+ 组真实会话原始评测数据集
└── test/                           # 163 项自动化单元与集成测试套件
```

---

## 📚 学术引用（Citation）

如果在学术研究或工业实践中使用了 DSH-OSWYN，请按如下格式引用：

```bibtex
@article{zhang2026oswyn,
  title   = {OSWYN: Preserving Capability Boundaries and KV-Cache Locality in Long-Horizon Software Engineering Agents via In-Band Step-Boundary Context Distillation},
  author  = {Zhang, Rentong},
  journal = {Keycap AI Research Archive},
  year    = {2026},
  volume  = {2},
  number  = {1},
  pages   = {1--42},
  note    = {Artifact: paper/oswyn-paper.md, Repository: https://github.com/keycapai/dsh-oswyn}
}
```

---

## 📄 许可证（License）

本项目基于 [MIT License](LICENSE) 协议开源。
