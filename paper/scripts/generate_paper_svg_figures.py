import os

def generate_svg_fig1():
    # 15-step continuous trajectory Line Chart
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 520" width="100%" height="100%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="1120" height="520" rx="10" fill="url(#bgGrad)" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- Title & Subtitle -->
  <text x="560" y="34" text-anchor="middle" font-size="17" font-weight="700" fill="#0f172a">
    图 1：15 步连续 SWE 会话上下文增长与累计计费演进折线图 (模型: DeepSeek 4.1 Flash)
  </text>
  <text x="560" y="55" text-anchor="middle" font-size="12" fill="#64748b">
    左图：单步 Prompt Tokens 演进折线图 (Step 1–15) ｜ 右图：累计实际 API 计费演进折线图 (元 RMB, 实测全量数据)
  </text>

  <!-- Legend -->
  <g transform="translate(180, 72)" font-size="11.5" font-weight="600">
    <line x1="0" y1="6" x2="24" y2="6" stroke="#64748b" stroke-width="2.5" stroke-dasharray="5,3"/>
    <circle cx="12" cy="6" r="3.5" fill="#64748b"/>
    <text x="32" y="10" fill="#475569">Baseline (无压缩基线)</text>

    <line x1="260" y1="6" x2="284" y2="6" stroke="#10b981" stroke-width="3"/>
    <circle cx="272" cy="6" r="4" fill="#10b981"/>
    <text x="292" y="10" fill="#065f46">OSWYN-Standard (原位微蒸馏)</text>

    <line x1="560" y1="6" x2="584" y2="6" stroke="#f59e0b" stroke-width="2.5"/>
    <circle cx="572" cy="6" r="3.5" fill="#f59e0b"/>
    <text x="592" y="10" fill="#92400e">Billion-Context (主动折叠)</text>
  </g>

  <!-- ================= LEFT PANEL: Prompt Tokens Line Chart (0 to 24000) ================= -->
  <g transform="translate(70, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(a) 单步 Prompt Tokens 增长折线图 (Step 1 → 15)</text>
    <!-- Axes -->
    <line x1="0" y1="330" x2="430" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines & Y-labels (0 to 24k, height=330, step=4k -> 55px) -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="275" x2="430" y2="275"/><line x1="0" y1="220" x2="430" y2="220"/>
      <line x1="0" y1="165" x2="430" y2="165"/><line x1="0" y1="110" x2="430" y2="110"/>
      <line x1="0" y1="55" x2="430" y2="55"/><line x1="0" y1="0" x2="430" y2="0"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="334">0</text><text x="-8" y="279">4k</text><text x="-8" y="224">8k</text>
      <text x="-8" y="169">12k</text><text x="-8" y="114">16k</text><text x="-8" y="59">20k</text><text x="-8" y="4">24k</text>
    </g>

    <!-- X-axis labels (Steps 1..15, dx=430/14=30.71) -->
    <g font-size="10" fill="#64748b" text-anchor="middle">
      <text x="0" y="348">S1</text><text x="61.4" y="348">S3</text><text x="122.9" y="348">S5</text>
      <text x="184.3" y="348">S7</text><text x="245.7" y="348">S9</text><text x="307.1" y="348">S11</text>
      <text x="368.6" y="348">S13</text><text x="430" y="348">S15</text>
    </g>

    <!-- Baseline Curve: 1100, 2450, 3980, 5820, 7150, 8900, 10450, 12300, 13800, 15400, 16900, 18500, 19800, 20600, 21445 -->
    <!-- y = 330 - (val / 24000) * 330 -->
    <polyline fill="none" stroke="#64748b" stroke-width="2.5" stroke-dasharray="5,3"
      points="0,314.9 30.7,296.3 61.4,275.3 92.1,249.9 122.9,231.7 153.6,207.6 184.3,186.3 215.0,160.9 245.7,140.3 276.4,118.3 307.1,97.6 337.9,75.6 368.6,57.8 399.3,46.8 430.0,35.1"/>
    <circle cx="430" cy="35.1" r="4" fill="#64748b"/>
    <text x="425" y="24" text-anchor="end" font-size="10.5" font-weight="700" fill="#475569">21,445 tok (Baseline)</text>

    <!-- Billion-Context Active: 1100, 2450, 3980, 5820, 7150, 4200, 5800, 7400, 8900, 6100, 7600, 9200, 6800, 8100, 9120 -->
    <polyline fill="none" stroke="#f59e0b" stroke-width="2.2"
      points="0,314.9 30.7,296.3 61.4,275.3 92.1,249.9 122.9,231.7 153.6,272.3 184.3,250.3 215.0,228.3 245.7,207.6 276.4,246.1 307.1,225.5 337.9,203.5 368.6,236.5 399.3,218.6 430.0,204.6"/>
    <circle cx="430" cy="204.6" r="4" fill="#f59e0b"/>
    <text x="425" y="222" text-anchor="end" font-size="10.5" font-weight="700" fill="#b45309">9,120 tok (BC Active 锯齿折叠)</text>

    <!-- OSWYN-Standard: 1100, 1850, 2400, 3200, 3950, 4800, 5600, 6400, 7100, 7900, 8400, 8900, 9300, 9600, 9868 -->
    <polyline fill="none" stroke="#10b981" stroke-width="3"
      points="0,314.9 30.7,304.6 61.4,297.0 92.1,286.0 122.9,275.7 153.6,264.0 184.3,253.0 215.0,242.0 245.7,232.4 276.4,221.4 307.1,214.5 337.9,207.6 368.6,202.1 399.3,198.0 430.0,194.3"/>
    <circle cx="430" cy="194.3" r="4.5" fill="#10b981"/>
    <text x="425" y="180" text-anchor="end" font-size="10.5" font-weight="700" fill="#047857">9,868 tok (OSWYN -54.0%)</text>
  </g>

  <!-- ================= RIGHT PANEL: Cumulative Cost Line Chart (¥0.00 to ¥0.11) ================= -->
  <g transform="translate(620, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(b) 累计真实 API 账单演进折线图 (元 RMB)</text>
    <!-- Axes -->
    <line x1="0" y1="330" x2="430" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines & Y-labels (0 to 0.11, height=330, step=0.02 -> 60px) -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="270" x2="430" y2="270"/><line x1="0" y1="210" x2="430" y2="210"/>
      <line x1="0" y1="150" x2="430" y2="150"/><line x1="0" y1="90" x2="430" y2="90"/>
      <line x1="0" y1="30" x2="430" y2="30"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="334">¥0.00</text><text x="-8" y="274">¥0.02</text><text x="-8" y="214">¥0.04</text>
      <text x="-8" y="154">¥0.06</text><text x="-8" y="94">¥0.08</text><text x="-8" y="34">¥0.10</text>
    </g>

    <!-- X-axis labels (Steps 1, 3, 5, 7, 9, 11, 13, 15: dx=430/7=61.43) -->
    <g font-size="10" fill="#64748b" text-anchor="middle">
      <text x="0" y="348">S1</text><text x="61.4" y="348">S3</text><text x="122.9" y="348">S5</text>
      <text x="184.3" y="348">S7</text><text x="245.7" y="348">S9</text><text x="307.1" y="348">S11</text>
      <text x="368.6" y="348">S13</text><text x="430" y="348">S15</text>
    </g>

    <!-- Baseline Cost: 0.002, 0.008, 0.018, 0.031, 0.046, 0.061, 0.071, 0.0782 -->
    <!-- y = 330 - (val / 0.11) * 330 -->
    <polyline fill="none" stroke="#64748b" stroke-width="2.5" stroke-dasharray="5,3"
      points="0,324.0 61.4,306.0 122.9,276.0 184.3,237.0 245.7,192.0 307.1,147.0 368.6,117.0 430.0,95.4"/>
    <circle cx="430" cy="95.4" r="4" fill="#64748b"/>
    <text x="425" y="85" text-anchor="end" font-size="10.5" font-weight="700" fill="#475569">¥0.0782 (全缓存基线)</text>

    <!-- Billion-Context Active Cost: 0.002, 0.010, 0.024, 0.042, 0.060, 0.075, 0.085, 0.0926 -->
    <polyline fill="none" stroke="#f59e0b" stroke-width="2.2"
      points="0,324.0 61.4,300.0 122.9,258.0 184.3,204.0 245.7,150.0 307.1,105.0 368.6,75.0 430.0,52.2"/>
    <circle cx="430" cy="52.2" r="4" fill="#f59e0b"/>
    <text x="425" y="42" text-anchor="end" font-size="10.5" font-weight="700" fill="#b45309">¥0.0926 (折叠前缀失效)</text>

    <!-- OSWYN-Standard Cost: 0.002, 0.011, 0.027, 0.045, 0.063, 0.077, 0.088, 0.0949 -->
    <polyline fill="none" stroke="#10b981" stroke-width="3"
      points="0,324.0 61.4,297.0 122.9,249.0 184.3,195.0 245.7,141.0 307.1,99.0 368.6,66.0 430.0,45.3"/>
    <circle cx="430" cy="45.3" r="4.5" fill="#10b981"/>
    <text x="425" y="28" text-anchor="end" font-size="10.5" font-weight="700" fill="#047857">¥0.0949 (生成护智围栏)</text>
  </g>
</svg>"""

def generate_svg_fig2():
    # 50-step continuous multi-round trajectory Line Chart
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 520" width="100%" height="100%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif">
  <defs>
    <linearGradient id="bgGrad2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="1120" height="520" rx="10" fill="url(#bgGrad2)" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- Title & Subtitle -->
  <text x="560" y="34" text-anchor="middle" font-size="17" font-weight="700" fill="#0f172a">
    图 2：50 步长程窗口计费 Tokens 规模与真实 API 累计账单演进折线图
  </text>
  <text x="560" y="55" text-anchor="middle" font-size="12" fill="#64748b">
    左图：长程步数演化下累积总计费 Tokens 规模 (Tokens) ｜ 右图：长程步数实测真实 API 累计账单演进 (元 RMB)
  </text>

  <!-- Legend -->
  <g transform="translate(340, 72)" font-size="11.5" font-weight="600">
    <line x1="0" y1="6" x2="28" y2="6" stroke="#64748b" stroke-width="2.5" stroke-dasharray="5,3"/>
    <circle cx="14" cy="6" r="3.5" fill="#64748b"/>
    <text x="36" y="10" fill="#475569">Baseline (无压缩长程二次方爆炸)</text>

    <line x1="280" y1="6" x2="308" y2="6" stroke="#10b981" stroke-width="3"/>
    <circle cx="294" cy="6" r="4.5" fill="#10b981"/>
    <text x="316" y="10" fill="#065f46">OSWYN-Standard (微蒸馏线性受敛)</text>
  </g>

  <!-- ================= LEFT PANEL: 50-step Tokens Line Chart (0 to 1,500,000) ================= -->
  <g transform="translate(70, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(a) 累积总计费 Tokens 演化折线图 (5 → 50 步)</text>
    <!-- Axes -->
    <line x1="0" y1="330" x2="430" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines & Y-labels (0 to 1.5M, step 0.3M -> 66px) -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="264" x2="430" y2="264"/><line x1="0" y1="198" x2="430" y2="198"/>
      <line x1="0" y1="132" x2="430" y2="132"/><line x1="0" y1="66" x2="430" y2="66"/><line x1="0" y1="0" x2="430" y2="0"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="334">0</text><text x="-8" y="268">300k</text><text x="-8" y="202">600k</text>
      <text x="-8" y="136">900k</text><text x="-8" y="70">1.2M</text><text x="-8" y="4">1.5M</text>
    </g>

    <!-- X-axis labels (Steps 5, 10, 15, 30, 50) -->
    <!-- Distances proportional: 5->0, 10->48, 15->96, 30->239, 50->430 -->
    <g font-size="10" fill="#64748b" text-anchor="middle">
      <text x="0" y="348">第 5 步</text><text x="47.8" y="348">第 10 步</text><text x="95.6" y="348">第 15 步</text>
      <text x="238.9" y="348">第 30 步</text><text x="430" y="348">第 50 步</text>
    </g>

    <!-- Baseline Tokens: 16417, 60258, 130869, 507086, 1391959 -->
    <!-- y = 330 - (val / 1500000) * 330 -->
    <polyline fill="none" stroke="#64748b" stroke-width="2.5" stroke-dasharray="5,3"
      points="0,326.4 47.8,316.7 95.6,301.2 238.9,218.4 430.0,23.8"/>
    <circle cx="430" cy="23.8" r="4.5" fill="#64748b"/>
    <text x="420" y="15" text-anchor="end" font-size="10.5" font-weight="700" fill="#475569">1,391,959 Tokens (Baseline)</text>

    <!-- OSWYN Tokens: 2990, 10789, 23704, 93305, 260274 -->
    <polyline fill="none" stroke="#10b981" stroke-width="3"
      points="0,329.3 47.8,327.6 95.6,324.8 238.9,309.5 430.0,272.7"/>
    <circle cx="430" cy="272.7" r="5" fill="#10b981"/>
    <text x="420" y="260" text-anchor="end" font-size="10.5" font-weight="700" fill="#047857">260,274 Tokens (-81.30%)</text>
  </g>

  <!-- ================= RIGHT PANEL: 50-step Billing Line Chart (0 to 0.11 RMB) ================= -->
  <g transform="translate(620, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(b) 实测真实 API 累计账单演化折线图 (元 RMB)</text>
    <!-- Axes -->
    <line x1="0" y1="330" x2="430" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="330" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines & Y-labels (0 to 0.11, step 0.02 -> 60px) -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="270" x2="430" y2="270"/><line x1="0" y1="210" x2="430" y2="210"/>
      <line x1="0" y1="150" x2="430" y2="150"/><line x1="0" y1="90" x2="430" y2="90"/><line x1="0" y1="30" x2="430" y2="30"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="334">¥0.00</text><text x="-8" y="274">¥0.02</text><text x="-8" y="214">¥0.04</text>
      <text x="-8" y="154">¥0.06</text><text x="-8" y="94">¥0.08</text><text x="-8" y="34">¥0.10</text>
    </g>

    <!-- X-axis labels (Steps 5, 10, 15, 30, 50) -->
    <g font-size="10" fill="#64748b" text-anchor="middle">
      <text x="0" y="348">第 5 步</text><text x="47.8" y="348">第 10 步</text><text x="95.6" y="348">第 15 步</text>
      <text x="238.9" y="348">第 30 步</text><text x="430" y="348">第 50 步</text>
    </g>

    <!-- Baseline Billing: 0.0068, 0.0148, 0.0229, 0.0510, 0.0966 -->
    <!-- y = 330 - (val / 0.11) * 330 -->
    <polyline fill="none" stroke="#64748b" stroke-width="2.5" stroke-dasharray="5,3"
      points="0,309.6 47.8,285.6 95.6,261.3 238.9,177.0 430.0,40.2"/>
    <circle cx="430" cy="40.2" r="4.5" fill="#64748b"/>
    <text x="420" y="30" text-anchor="end" font-size="10.5" font-weight="700" fill="#475569">¥0.0966 (Baseline 支出)</text>

    <!-- OSWYN Billing: 0.0022, 0.0045, 0.0078, 0.0175, 0.0334 -->
    <polyline fill="none" stroke="#10b981" stroke-width="3"
      points="0,323.4 47.8,316.5 95.6,306.6 238.9,277.5 430.0,229.8"/>
    <circle cx="430" cy="229.8" r="5" fill="#10b981"/>
    <text x="420" y="220" text-anchor="end" font-size="10.5" font-weight="700" fill="#047857">¥0.0334 (净节省 -65.42%)</text>
  </g>
</svg>"""

def generate_svg_fig3():
    # Model Willingness across difficulties Bar Chart
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 480" width="100%" height="100%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif">
  <defs>
    <linearGradient id="bgGrad3" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="1120" height="480" rx="10" fill="url(#bgGrad3)" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- Title & Subtitle -->
  <text x="560" y="34" text-anchor="middle" font-size="17" font-weight="700" fill="#0f172a">
    图 3：跨代际模型在不同任务难度与认知负荷下的主动压缩意愿柱状图
  </text>
  <text x="560" y="55" text-anchor="middle" font-size="12" fill="#64748b">
    左图：5 款模型总体主动压缩意愿 (9 步汇总) ｜ 右图：困难任务 (L3_Hard 复杂代码栈) 下单步 Nudge 纠偏效果
  </text>

  <!-- Legend -->
  <g transform="translate(390, 72)" font-size="11.5" font-weight="600">
    <rect x="0" y="0" width="16" height="12" rx="3" fill="#94a3b8"/>
    <text x="24" y="10" fill="#475569">无单步 Nudge (纯自发)</text>

    <rect x="180" y="0" width="16" height="12" rx="3" fill="#2563eb"/>
    <text x="204" y="10" fill="#1e3a8a">有单步 Nudge (纠偏后)</text>
  </g>

  <!-- ================= LEFT PANEL: Overall 9-step Willingness Bar Chart ================= -->
  <g transform="translate(70, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(a) 跨代际模型总体主动压缩意愿 (9 步汇总, %)</text>
    <!-- Axes -->
    <line x1="0" y1="280" x2="430" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines & Y-labels (0% to 100%, step 25% -> 70px) -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="210" x2="430" y2="210"/><line x1="0" y1="140" x2="430" y2="140"/>
      <line x1="0" y1="70" x2="430" y2="70"/><line x1="0" y1="0" x2="430" y2="0"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="284">0%</text><text x="-8" y="214">25%</text><text x="-8" y="144">50%</text>
      <text x="-8" y="74">75%</text><text x="-8" y="4">100%</text>
    </g>

    <!-- 5 Models Groups: DS4.1f, Gem3.8f, Kimi3.1, Hunyuan4, Gem4 (group_w = 86) -->
    <!-- DS 4.1 Flash: 22.2% (62.2px) vs 77.8% (217.8px) -->
    <g transform="translate(15, 0)">
      <rect x="0" y="217.8" width="24" height="62.2" rx="3" fill="#94a3b8"/>
      <text x="12" y="212" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">22%</text>
      <rect x="28" y="62.2" width="24" height="217.8" rx="3" fill="#2563eb"/>
      <text x="40" y="56" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">78%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">DS Flash</text>
    </g>

    <!-- Gem 3.8 Flash: 77.8% vs 88.9% -->
    <g transform="translate(101, 0)">
      <rect x="0" y="62.2" width="24" height="217.8" rx="3" fill="#94a3b8"/>
      <text x="12" y="56" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">78%</text>
      <rect x="28" y="31.1" width="24" height="248.9" rx="3" fill="#2563eb"/>
      <text x="40" y="25" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">89%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Gemini 3.8f</text>
    </g>

    <!-- Kimi 3.1: 100% vs 88.9% -->
    <g transform="translate(187, 0)">
      <rect x="0" y="0" width="24" height="280" rx="3" fill="#94a3b8"/>
      <text x="12" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">100%</text>
      <rect x="28" y="31.1" width="24" height="248.9" rx="3" fill="#2563eb"/>
      <text x="40" y="25" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">89%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Kimi 3.1 Pro</text>
    </g>

    <!-- Hunyuan 4: 100% vs 100% -->
    <g transform="translate(273, 0)">
      <rect x="0" y="0" width="24" height="280" rx="3" fill="#94a3b8"/>
      <text x="12" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">100%</text>
      <rect x="28" y="0" width="24" height="280" rx="3" fill="#2563eb"/>
      <text x="40" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">100%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Hunyuan 4</text>
    </g>

    <!-- Gemini 4: 100% vs 88.9% -->
    <g transform="translate(359, 0)">
      <rect x="0" y="0" width="24" height="280" rx="3" fill="#94a3b8"/>
      <text x="12" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">100%</text>
      <rect x="28" y="31.1" width="24" height="248.9" rx="3" fill="#2563eb"/>
      <text x="40" y="25" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">89%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Gemini 4</text>
    </g>
  </g>

  <!-- ================= RIGHT PANEL: L3_Hard Willingness Bar Chart ================= -->
  <g transform="translate(620, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(b) 困难任务 (L3_Hard 复杂代码栈) 主动压缩意愿 (%)</text>
    <!-- Axes -->
    <line x1="0" y1="280" x2="430" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines & Y-labels -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="210" x2="430" y2="210"/><line x1="0" y1="140" x2="430" y2="140"/>
      <line x1="0" y1="70" x2="430" y2="70"/><line x1="0" y1="0" x2="430" y2="0"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="284">0%</text><text x="-8" y="214">25%</text><text x="-8" y="144">50%</text>
      <text x="-8" y="74">75%</text><text x="-8" y="4">100%</text>
    </g>

    <!-- DS Flash: 25.0% vs 75.0% (+50% jump!) -->
    <g transform="translate(15, 0)">
      <rect x="0" y="210" width="24" height="70" rx="3" fill="#94a3b8"/>
      <text x="12" y="204" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">25%</text>
      <rect x="28" y="70" width="24" height="210" rx="3" fill="#2563eb"/>
      <text x="40" y="64" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">75%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">DS Flash</text>
    </g>

    <!-- Gem 3.8f: 75.0% vs 75.0% -->
    <g transform="translate(101, 0)">
      <rect x="0" y="70" width="24" height="210" rx="3" fill="#94a3b8"/>
      <text x="12" y="64" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">75%</text>
      <rect x="28" y="70" width="24" height="210" rx="3" fill="#2563eb"/>
      <text x="40" y="64" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">75%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Gemini 3.8f</text>
    </g>

    <!-- Kimi 3.1: 100% vs 75.0% -->
    <g transform="translate(187, 0)">
      <rect x="0" y="0" width="24" height="280" rx="3" fill="#94a3b8"/>
      <text x="12" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">100%</text>
      <rect x="28" y="70" width="24" height="210" rx="3" fill="#2563eb"/>
      <text x="40" y="64" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">75%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Kimi 3.1 Pro</text>
    </g>

    <!-- Hunyuan 4: 100% vs 100% -->
    <g transform="translate(273, 0)">
      <rect x="0" y="0" width="24" height="280" rx="3" fill="#94a3b8"/>
      <text x="12" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">100%</text>
      <rect x="28" y="0" width="24" height="280" rx="3" fill="#2563eb"/>
      <text x="40" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">100%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Hunyuan 4</text>
    </g>

    <!-- Gemini 4: 100% vs 75.0% -->
    <g transform="translate(359, 0)">
      <rect x="0" y="0" width="24" height="280" rx="3" fill="#94a3b8"/>
      <text x="12" y="-5" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">100%</text>
      <rect x="28" y="70" width="24" height="210" rx="3" fill="#2563eb"/>
      <text x="40" y="64" text-anchor="middle" font-size="9" font-weight="700" fill="#1d4ed8">75%</text>
      <text x="26" y="298" text-anchor="middle" font-size="10" fill="#334155">Gemini 4</text>
    </g>
  </g>
</svg>"""

def generate_svg_fig4():
    # Prompt Ablation Bar Chart
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 480" width="100%" height="100%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif">
  <defs>
    <linearGradient id="bgGrad4" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="1120" height="480" rx="10" fill="url(#bgGrad4)" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- Title & Subtitle -->
  <text x="560" y="34" text-anchor="middle" font-size="17" font-weight="700" fill="#0f172a">
    图 4：系统提示词变体消融主动压缩意愿与净有效压缩率对比柱状图 (模型: DeepSeek 4.1 Flash)
  </text>
  <text x="560" y="55" text-anchor="middle" font-size="12" fill="#64748b">
    左图：主动压缩意愿与“道德风险”机制对比 ｜ 右图：净有效压缩率与关键常量探针召回率 (x/3)
  </text>

  <!-- Legend -->
  <g transform="translate(370, 72)" font-size="11.5" font-weight="600">
    <rect x="0" y="0" width="16" height="12" rx="3" fill="#3b82f6"/>
    <text x="24" y="10" fill="#1e40af">主动压缩意愿 (%)</text>

    <rect x="180" y="0" width="16" height="12" rx="3" fill="#10b981"/>
    <text x="204" y="10" fill="#065f46">净有效压缩率 (%)</text>
  </g>

  <!-- ================= LEFT PANEL: Prompt Willingness Bar Chart ================= -->
  <g transform="translate(70, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(a) 提示词变体主动意愿对比 (%)</text>
    <line x1="0" y1="280" x2="430" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>

    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="210" x2="430" y2="210"/><line x1="0" y1="140" x2="430" y2="140"/>
      <line x1="0" y1="70" x2="430" y2="70"/><line x1="0" y1="0" x2="430" y2="0"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="284">0%</text><text x="-8" y="214">25%</text><text x="-8" y="144">50%</text>
      <text x="-8" y="74">75%</text><text x="-8" y="4">100%</text>
    </g>

    <!-- P1, P2, P3, P4 -->
    <!-- P1: 33.3% -> 93.2px -->
    <g transform="translate(35, 0)">
      <rect x="0" y="186.8" width="50" height="93.2" rx="4" fill="#3b82f6"/>
      <text x="25" y="180" text-anchor="middle" font-size="11" font-weight="700" fill="#1d4ed8">33.3%</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">P1 原始基线</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" fill="#64748b">(无结构化分流)</text>
    </g>

    <!-- P2: 0.0% (Moral Hazard) -->
    <g transform="translate(135, 0)">
      <rect x="0" y="278" width="50" height="2" rx="1" fill="#ef4444"/>
      <text x="25" y="268" text-anchor="middle" font-size="11" font-weight="700" fill="#dc2626">0.0% 崩塌</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="600" fill="#991b1b">P2 披露兜底</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" fill="#dc2626">(道德风险引发放弃)</text>
    </g>

    <!-- P3: 100.0% -->
    <g transform="translate(235, 0)">
      <rect x="0" y="0" width="50" height="280" rx="4" fill="#10b981"/>
      <text x="25" y="-6" text-anchor="middle" font-size="11" font-weight="700" fill="#047857">100.0% 满分</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="700" fill="#065f46">P3 决策树</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" font-weight="600" fill="#047857">(生产标准最优解)</text>
    </g>

    <!-- P4: 66.7% -> 186.8px -->
    <g transform="translate(335, 0)">
      <rect x="0" y="93.2" width="50" height="186.8" rx="4" fill="#3b82f6"/>
      <text x="25" y="86" text-anchor="middle" font-size="11" font-weight="700" fill="#1d4ed8">66.7%</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">P4 极简版</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" fill="#64748b">(易发生格式漂移)</text>
    </g>
  </g>

  <!-- ================= RIGHT PANEL: Compression Ratio & Constant Recall ================= -->
  <g transform="translate(620, 115)">
    <text x="215" y="-12" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">(b) 净有效压缩率 (%) 与探针召回率</text>
    <line x1="0" y1="280" x2="430" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="280" stroke="#cbd5e1" stroke-width="1.5"/>

    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="210" x2="430" y2="210"/><line x1="0" y1="140" x2="430" y2="140"/>
      <line x1="0" y1="70" x2="430" y2="70"/><line x1="0" y1="0" x2="430" y2="0"/>
    </g>
    <g font-size="10" fill="#64748b" text-anchor="end">
      <text x="-8" y="284">0%</text><text x="-8" y="214">25%</text><text x="-8" y="144">50%</text>
      <text x="-8" y="74">75%</text><text x="-8" y="4">100%</text>
    </g>

    <!-- P1: 31.1% -> 87.1px -->
    <g transform="translate(35, 0)">
      <rect x="0" y="192.9" width="50" height="87.1" rx="4" fill="#10b981"/>
      <text x="25" y="186" text-anchor="middle" font-size="11" font-weight="700" fill="#047857">31.1%</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">P1 原始基线</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" fill="#10b981">召回: 3/3</text>
    </g>

    <!-- P2: 0.0% -->
    <g transform="translate(135, 0)">
      <rect x="0" y="278" width="50" height="2" rx="1" fill="#ef4444"/>
      <text x="25" y="268" text-anchor="middle" font-size="11" font-weight="700" fill="#dc2626">0.0% 无压缩</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="600" fill="#991b1b">P2 披露兜底</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" fill="#ef4444">召回: 2/3 (丢变量)</text>
    </g>

    <!-- P3: 91.2% -> 255.4px -->
    <g transform="translate(235, 0)">
      <rect x="0" y="24.6" width="50" height="255.4" rx="4" fill="#059669"/>
      <text x="25" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="#047857">91.2% 最高</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="700" fill="#065f46">P3 决策树</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" font-weight="700" fill="#047857">召回: 3/3 满分</text>
    </g>

    <!-- P4: 65.0% -> 182.0px -->
    <g transform="translate(335, 0)">
      <rect x="0" y="98.0" width="50" height="182.0" rx="4" fill="#10b981"/>
      <text x="25" y="91" text-anchor="middle" font-size="11" font-weight="700" fill="#047857">65.0%</text>
      <text x="25" y="298" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">P4 极简版</text>
      <text x="25" y="312" text-anchor="middle" font-size="9" fill="#f59e0b">召回: 2/3 (漂移)</text>
    </g>
  </g>
</svg>"""

def generate_svg_fig5():
    # Full-spectrum pass rates across categories Bar Chart
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 500" width="100%" height="100%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif">
  <defs>
    <linearGradient id="bgGrad5" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="1120" height="500" rx="10" fill="url(#bgGrad5)" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- Title & Subtitle -->
  <text x="560" y="34" text-anchor="middle" font-size="17" font-weight="700" fill="#0f172a">
    图 5：能力边界全谱系基准四大任务子集架构求解通过率对比柱状图
  </text>
  <text x="560" y="55" text-anchor="middle" font-size="12" fill="#64748b">
    对比四大子集：常规工程任务、复杂算法与约束推理、程序化沙箱协同及全谱系有效实测总计 (全实测，未测项不计入分母)
  </text>

  <!-- Legend -->
  <g transform="translate(180, 72)" font-size="11.5" font-weight="600">
    <rect x="0" y="0" width="15" height="12" rx="3" fill="#64748b"/>
    <text x="22" y="10" fill="#334155">DS Flash Baseline</text>

    <rect x="180" y="0" width="15" height="12" rx="3" fill="#0284c7"/>
    <text x="202" y="10" fill="#0369a1">DS Flash + OSWYN</text>

    <rect x="370" y="0" width="15" height="12" rx="3" fill="#8b5cf6"/>
    <text x="392" y="10" fill="#6d28d9">Gemini 4 Baseline</text>

    <rect x="560" y="0" width="15" height="12" rx="3" fill="#10b981"/>
    <text x="582" y="10" fill="#047857">Gemini 4 + OSWYN</text>
  </g>

  <!-- Main Chart Area -->
  <g transform="translate(70, 115)">
    <!-- Axes -->
    <line x1="0" y1="300" x2="980" y2="300" stroke="#cbd5e1" stroke-width="1.5"/>
    <line x1="0" y1="0" x2="0" y2="300" stroke="#cbd5e1" stroke-width="1.5"/>

    <!-- Gridlines (0% to 100%, step 20% -> 60px) -->
    <g stroke="#f1f5f9" stroke-width="1">
      <line x1="0" y1="240" x2="980" y2="240"/><line x1="0" y1="180" x2="980" y2="180"/>
      <line x1="0" y1="120" x2="980" y2="120"/><line x1="0" y1="60" x2="980" y2="60"/><line x1="0" y1="0" x2="980" y2="0"/>
    </g>
    <g font-size="10.5" fill="#64748b" text-anchor="end">
      <text x="-8" y="304">0%</text><text x="-8" y="244">20%</text><text x="-8" y="184">40%</text>
      <text x="-8" y="124">60%</text><text x="-8" y="64">80%</text><text x="-8" y="4">100%</text>
    </g>

    <!-- Group 1: 常规工程任务 (B1-B10, 10题) -> x center = 130 -->
    <!-- DS BL: 96.7% (290px), DS OSWYN: 100% (300px), Gem BL: 100% (300px), Gem OSWYN: 100% (300px) -->
    <g transform="translate(45, 0)">
      <rect x="0" y="10" width="38" height="290" rx="4" fill="#64748b"/>
      <text x="19" y="4" text-anchor="middle" font-size="10" font-weight="700" fill="#475569">96.7%</text>

      <rect x="44" y="0" width="38" height="300" rx="4" fill="#0284c7"/>
      <text x="63" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1">100%</text>

      <rect x="88" y="0" width="38" height="300" rx="4" fill="#8b5cf6"/>
      <text x="107" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#6d28d9">100%</text>

      <rect x="132" y="0" width="38" height="300" rx="4" fill="#10b981"/>
      <text x="151" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#047857">100%</text>

      <text x="85" y="322" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">子集一：常规工程任务</text>
      <text x="85" y="338" text-anchor="middle" font-size="10.5" fill="#64748b">(B1–B10，共10题 / 80轮次)</text>
    </g>

    <!-- Group 2: 复杂算法与约束推理 (B11-B14, B17, 5题) -> x center = 390 -->
    <!-- DS BL: 46.2% (138.6px), DS OSWYN: 53.8% (161.4px), Gem BL: 100% (300px), Gem OSWYN: 100% (300px) -->
    <g transform="translate(295, 0)">
      <rect x="0" y="161.4" width="38" height="138.6" rx="4" fill="#64748b"/>
      <text x="19" y="155" text-anchor="middle" font-size="10" font-weight="700" fill="#475569">46.2%</text>

      <rect x="44" y="138.6" width="38" height="161.4" rx="4" fill="#0284c7"/>
      <text x="63" y="132" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1">53.8%</text>

      <rect x="88" y="0" width="38" height="300" rx="4" fill="#8b5cf6"/>
      <text x="107" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#6d28d9">100%</text>

      <rect x="132" y="0" width="38" height="300" rx="4" fill="#10b981"/>
      <text x="151" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#047857">100%</text>

      <text x="85" y="322" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">子集二：复杂算法与约束推理</text>
      <text x="85" y="338" text-anchor="middle" font-size="10.5" fill="#64748b">(B11–B14, B17，共5题 / 36轮次)</text>
    </g>

    <!-- Group 3: 程序化沙箱协同 (B15-B16 PTC, 2题) -> x center = 640 -->
    <!-- DS BL: 未测, DS OSWYN: 100% (300px), Gem BL: 未测, Gem OSWYN: 100% (300px) -->
    <g transform="translate(545, 0)">
      <rect x="0" y="296" width="38" height="4" rx="2" fill="#cbd5e1"/>
      <text x="19" y="288" text-anchor="middle" font-size="10" fill="#94a3b8">未测 —</text>

      <rect x="44" y="0" width="38" height="300" rx="4" fill="#0284c7"/>
      <text x="63" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1">100%</text>

      <rect x="88" y="296" width="38" height="4" rx="2" fill="#cbd5e1"/>
      <text x="107" y="288" text-anchor="middle" font-size="10" fill="#94a3b8">未测 —</text>

      <rect x="132" y="0" width="38" height="300" rx="4" fill="#10b981"/>
      <text x="151" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#047857">100%</text>

      <text x="85" y="322" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">子集三：程序化沙箱协同</text>
      <text x="85" y="338" text-anchor="middle" font-size="10.5" fill="#64748b">(B15–B16 PTC 代码执行 / 4轮次)</text>
    </g>

    <!-- Group 4: 全谱系实测总计 -> x center = 890 -->
    <!-- DS BL: 81.4% (244.2px), DS OSWYN: 86.7% (260.1px), Gem BL: 100% (300px), Gem OSWYN: 100% (300px) -->
    <g transform="translate(795, 0)">
      <rect x="0" y="55.8" width="38" height="244.2" rx="4" fill="#64748b"/>
      <text x="19" y="49" text-anchor="middle" font-size="10" font-weight="700" fill="#475569">81.4%</text>

      <rect x="44" y="39.9" width="38" height="260.1" rx="4" fill="#0284c7"/>
      <text x="63" y="33" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1">86.7%</text>

      <rect x="88" y="0" width="38" height="300" rx="4" fill="#8b5cf6"/>
      <text x="107" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#6d28d9">100%</text>

      <rect x="132" y="0" width="38" height="300" rx="4" fill="#10b981"/>
      <text x="151" y="-6" text-anchor="middle" font-size="10" font-weight="700" fill="#047857">100%</text>

      <text x="85" y="322" text-anchor="middle" font-size="12" font-weight="700" fill="#047857">全谱系有效实测总计</text>
      <text x="85" y="338" text-anchor="middle" font-size="10.5" font-weight="600" fill="#0f172a">(仅计有效实测项, 无重叠)</text>
    </g>
  </g>
</svg>"""

# Generate all SVGs and write to both directories
figures = {
    'fig1-15step-trajectory-lines.svg': generate_svg_fig1(),
    'fig2-50step-growth-lines.svg': generate_svg_fig2(),
    'fig3-willingness-models-barchart.svg': generate_svg_fig3(),
    'fig4-prompt-ablation-barchart.svg': generate_svg_fig4(),
    'fig5-full-spectrum-passrates-barchart.svg': generate_svg_fig5()
}

dirs = ['dsh-oswyn/paper/figures', 'deliverables/paper/figures']
for d in dirs:
    os.makedirs(d, exist_ok=True)
    for fname, content in figures.items():
        p = os.path.join(d, fname)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Wrote {p} ({len(content)} bytes)')

print('All 5 figures generated successfully!')
