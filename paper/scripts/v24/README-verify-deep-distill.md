# 如何验证深度蒸馏（post-cache deep distillation）是否生效

深度蒸馏按设计就是"不可见"的：它不改写账本里的任何一行，只改写发给模型的
outgoing 请求。所以它没有行级徽章可以依附。验证分三层，从便宜到真实。

## 第 1 层：离线仿真（30 秒，验证策略本身省不省）

```bash
node paper/scripts/v24/verify-deep-distill.mjs --seeds 5
```

用官方 v2.4 引擎在 293 条真实会话曲线上跑"出货配置 vs Origin Replay"。
脚本直接从 `lib/core/triggers.js` 和 `lib/config.js` 读取 R/V/V_hard/floor，
所以一旦默认值漂移，脚本会跟着变，不会骗人。任一项不达标会以非零码退出。

当前结果（--seeds 5）：成本 -55.9%，未缓存 token -54.1%，表层 -73.1%，
TTFT p99 -57.9%，78.6% 的会话至少触发一次。

## 第 2 层：单次请求的决策诊断（验证"为什么这次没压"）

每次 pre-step 都会把触发决策写进账本的 `session.distill.lastEval`：

| 字段 | 含义 |
| :--- | :--- |
| `surplusTokens` | 本次可剥离多少 token |
| `rawTokens` | 原始表层多大 |
| `signals.ttl/volume/rounds/ceiling` | 哪些信号武装了 |
| `armed` | 是否达到触发条件 |
| `floorBlocked` | 是否被防抖下限拦下 |
| `distill` / `reason` | 最终是否执行、因何执行 |

查法：

```bash
curl -s 'http://127.0.0.1:<port>/api/oswyn/status' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  for(const r of j.sessions.filter(x=>x.distill&&x.distill.lastEval).slice(0,5)){
    const e=r.distill.lastEval;
    console.log(r.sessionId.slice(0,24),'surplus=',e.surplusTokens,'armed=',e.armed,'floorBlocked=',e.floorBlocked,'distill=',e.distill,e.reason||'');
  }
});"
```

界面里也有：输入框下方的压缩统计胶囊 → 点击 → "上次触发评估 / 可剥离量 / 已武装信号"。

**这一层能区分三种"没压"**，而它们此前长得一模一样：

1. 没武装 —— 可剥离量和轮数都没到门槛，属于正常
2. 武装了但被 floor 拦下 —— 可剥离量 < 2000 tok，压了不划算
3. 真的执行了 —— `distill=true`，同时 `events` 会 +1

## 第 3 层：强制触发一次（验证端到端真的会压）

在会话里执行：

```
/oswyn-distill
```

它会设置 `session.forceCacheExpired = true`（这是 `isCacheExpired` 官方支持的
测试钩子），并打印当前的累计次数与上次评估数值。然后随便发一句话，下一次请求
必然执行一次整面重置。之后再看：

- `/oswyn-distill` 里的"当前会话累计"应从 0 变成 1
- 压缩统计浮窗里"深度蒸馏"出现次数与节省 token
- 设置页 → 运行统计与收益 → "深度蒸馏（缓存失效后整面重置）" KPI

## 为什么线上真实会话此前一次都没触发

两个独立原因，都已修复：

1. **coalesce 死锁**：旧代码 `cacheCold = expired || forceCacheExpired`，而
   `forceCacheExpired` 在生产链路没有入口，于是"等自然冷调用"退化成"等 TTL
   24 小时"。VOLUME/ROUNDS 武装后永远等不到执行窗口。全库 180 个会话
   `totalDistillEvents = 0` 就是这个原因。现已改为纯 eager，并删除 coalesce
   相关开关（推迟 N 轮在数学上等价于把 R 调大 N，没有独立价值）。

2. **默认值与论文相反**：论文 §6.2/§9.1 推荐 `coalesce = false`（eager 便宜
   2.65%，$26.47 vs $27.19，CI 不重叠），但代码默认是 `true`。已对齐。

## 注意

`session.distill.events = 602` 的那个 `replay` 会话是基准脚本的产物，不是真实
会话。判断真实链路要看具体会话 id，不要看全局总数。


## 重要勘误（v2.4.1）：深度蒸馏原先并未真正作用于请求

离线验证器 `verify-deep-distill.mjs` 模拟的是"投影能生效"的理想情况。真实链路曾经
做不到，原因如下：

| 层 | 真实数据来源 | 旧实现用了哪个 |
| :--- | :--- | :--- |
| 真实请求的消息 | `session.deriveMessages()`（agent.ts:734） | — |
| `agent/pre-step` 的 `messages` | `inbox.claim()`，只是本步新消息（agent.ts:293） | ✅ 旧实现用了这个 |

因此 `projectOutgoing` 的投影只作用在"本步新增消息"上，历史一个字都没改。
证据：真实会话 `lastEval.rawTokens` 恒为 1443（约等于 system prompt），而账本是
160KB；实际请求 totalTokens 从 turn1 的 45K 单调涨到 turn13 的 394K，
从未因蒸馏回落。

### 修复：改用 kernel 的 message projection

`lib/core/distill-projection.js` 注册 `oswyn/distill` 事件类型，通过
`ctx.sessions.registerMessageProjection()` 在 `deriveMessages()` 折叠阶段替换
历史消息内容（只改 content，不改节点、不改消息身份、不影响用户可见记录）。
这与 `dsh-compaction-image-offload` 用的是同一套官方机制。

蒸馏内容：
- 历史 assistant 消息：删除 `reasoning` 块与 `<think>` 标签
- 历史 tool/result：替换为一行占位（保留 toolCallId，维持协议配对）
- 当前回合：逐字节不动

### 实测收益（当前会话 976 个表层节点）

| 指标 | 蒸馏前 | 蒸馏后 | 降幅 |
| :--- | ---: | ---: | ---: |
| 字符 | 2,135,725 | 1,061,071 | **50.3%** |
| 估算 token | ~610,207 | ~303,163 | — |

### 验证方式

重启 DSH 后，正常对话即可。检查：

```bash
curl -s 'http://127.0.0.1:<port>/api/oswyn/status' | node -e "..."
```

看 `sessions[].distill.events > 0`、`lastEval.messageCount` 应该是几百（表层层节点数），
且下一次请求的 `usage.totalTokens` 应明显低于蒸馏前的线性外推值。
