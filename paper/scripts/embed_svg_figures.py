import re

def embed_figures(content):
    # 1. Section 5.1.1: Replace xychart-beta blocks with Fig 1 SVG
    s511_start = content.find("#### 5.1.1 上下文增长")
    s512_start = content.find("#### 5.1.2 上下文微蒸馏")
    assert s511_start != -1 and s512_start != -1, "5.1.1 or 5.1.2 not found"

    new_s511 = """#### 5.1.1 上下文增长轨迹与计费演进（连续 15 步多轮折线图）

以下折线图基于 15 步连续软件工程交互轨迹，直观呈现了各架构在多轮步数推进中的单步上下文规模及累计真实 API 计费演化曲线（时间序列连续步数采用折线图直观刻画）：

![图 1：15 步连续 SWE 会话上下文增长与累计计费演进折线图](figures/fig1-15step-trajectory-lines.svg)

*(注：左图展示单步上行 Prompt Tokens 演进，基线呈现线性陡峭上升，OSWYN-Standard 压薄 54%，Billion-Context 在第 6、10、13 步展现主动工具折叠形成的锯齿波形；右图展示对应实测 API 账单演进)*

"""
    content = content[:s511_start] + new_s511 + content[s512_start:]

    # 2. Section 5.1.3: Replace xychart-beta blocks after Table 3 with Fig 2 SVG
    t3_pattern = re.compile(
        r'(\| \*\*第 50 步\*\* \|[^\n]+\n\n)```mermaid[\s\S]*?```\n\n```mermaid[\s\S]*?```\n\n(> \[!NOTE\])',
        re.DOTALL
    )
    m = t3_pattern.search(content)
    assert m, "Table 3 mermaid pattern not found"
    fig2_markdown = """![图 2：50 步长程窗口计费 Tokens 规模与真实 API 累计账单演进折线图](figures/fig2-50step-growth-lines.svg)

*(注：左图展示长程步数演化下累积计费 Tokens 规模，基线呈现二次方爆炸上升至 139 万，OSWYN 线性收敛至 26 万；右图展示真实 API 累计账单，OSWYN 在各阶段维持 65.4%–69.6% 的稳定净降幅)*

"""
    content = content[:m.start()] + m.group(1) + fig2_markdown + m.group(2) + content[m.end():]

    # 3. Section 5.2: Replace xychart-beta block after Table 4 with Fig 3 SVG
    t4_pattern = re.compile(
        r'(\| \*\*Gemini 4\*\*<br>\(`1 : 20 : 100`\)[^\n]+\n\n)```mermaid[\s\S]*?```\n\n(\*\*实证发现\*\*)',
        re.DOTALL
    )
    m4 = t4_pattern.search(content)
    assert m4, "Table 4 mermaid pattern not found"
    fig3_markdown = """![图 3：跨代际模型在不同任务难度与认知负荷下的主动压缩意愿柱状图](figures/fig3-willingness-models-barchart.svg)

*(注：左图展示 5 款跨代际模型在 9 步工具调用中的总体主动意愿；右图聚焦困难任务 L3_Hard，展示单步 Nudge 对轻量基座模型显著的纠偏激发效应)*

"""
    content = content[:m4.start()] + m4.group(1) + fig3_markdown + m4.group(2) + content[m4.end():]

    # 4. Section 5.3: Replace xychart-beta block after Table 5 with Fig 4 SVG
    t5_pattern = re.compile(
        r'(\| \*\*Gemini 4\*\* `P4_Minimal`[^\n]+\n\n)```mermaid[\s\S]*?```\n\n(#### 5\.3\.1 生产环境)',
        re.DOTALL
    )
    m5 = t5_pattern.search(content)
    assert m5, "Table 5 mermaid pattern not found"
    fig4_markdown = """![图 4：系统提示词变体消融主动压缩意愿与净有效压缩率对比柱状图](figures/fig4-prompt-ablation-barchart.svg)

*(注：左图直观展示过度披露系统兜底机制带来的“道德风险”意愿崩塌效应；右图对比有效载荷净压缩率与关键常量探针召回率，验证 P3 正向决策树的帕累托综合最优性)*

"""
    content = content[:m5.start()] + m5.group(1) + fig4_markdown + m5.group(2) + content[m5.end():]

    # 5. Section 5.4.4: Replace xychart-beta blocks after Table 6 with Fig 5 SVG
    t6_pattern = re.compile(
        r'(\*（注：1\. `\*` 标记表示单并发严格交替协议下 100% 满分通过[^\n]+\*\n\n)```mermaid[\s\S]*?```\n\n```mermaid[\s\S]*?```\n\n```mermaid[\s\S]*?```',
        re.DOTALL
    )
    m6 = t6_pattern.search(content)
    assert m6, "Table 6 mermaid pattern not found"
    fig5_markdown = """![图 5：能力边界全谱系基准四大任务子集架构求解通过率对比柱状图](figures/fig5-full-spectrum-passrates-barchart.svg)

*(注：四大子集对比均基于真实 API 单步实测，未测项目以“未测 —”标记且不计入对应基线分母，杜绝未测数据拉低通过率。全谱系有效实测总通过率中，Gemini 4 Baseline 与 Gemini 4 + OSWYN 均达 100.0% 满额通过)*"""
    content = content[:m6.start()] + m6.group(1) + fig5_markdown + content[m6.end():]

    return content

# Run on both files
for path in ['dsh-oswyn/paper/oswyn-empirical-paper.md', 'deliverables/paper/oswyn-empirical-paper.md']:
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    new_c = embed_figures(c)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_c)
    print(f'Successfully embedded figures in {path}')
