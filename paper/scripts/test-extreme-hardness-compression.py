import json
import urllib.request
import time
import os
import re
import subprocess

API_URL = "http://127.0.0.1:3425/v1/chat/completions"

def call_api(model, messages, max_tokens=16384, temperature=0.0):
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - t0
            usage = data.get("usage", {})
            choice = data["choices"][0]
            content = choice["message"].get("content", "")
            finish_reason = choice.get("finish_reason")
            return {
                "ok": True,
                "elapsed": elapsed,
                "content": content,
                "finish_reason": finish_reason,
                "usage": usage
            }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "elapsed": time.time() - t0
        }

# Define the 3 extreme problems
PROBLEMS = [
    {
        "id": "B15_Large_Semiprime_Factorization",
        "name": "B15: 20位大半素数心算分解 (N = 14052238206128879427)",
        "expected": "433494437",
        "verify": lambda s: bool(re.search(r'\b433494437\b', s)),
        "swe_context_raw": [
            "[System Boot Log - Memory Mapping Check]",
            "DMA Channel 0: base=0x7ffe0000, size=0x10000, status=ALLOCATED",
            "DMA Channel 1: base=0x7ffe1000, size=0x10000, status=ALLOCATED",
            "DMA Channel 2: base=0x7ffe2000, size=0x10000, status=ALLOCATED",
            "DMA Channel 3: base=0x7ffe3000, size=0x10000, status=ALLOCATED",
            "Kernel Panic Trace: Page fault at 0xdeadbeef during crypto key rotation.",
            "Thread 0x4a21 crashed in libcrypto.so: symbol lookup error: undefined symbol _crypto_aes_ni_init",
            "Stack Frame 0: 0x7fff8921a400 in crypto_dispatch_work ()",
            "Stack Frame 1: 0x7fff8921b820 in key_vault_init ()",
            "Stack Frame 2: 0x7fff8921c110 in main ()",
            "Environment variables: ARCH=x86_64, LIBC=musl, SYS_LOAD=0.92, MEM_FREE=1420MB",
            "Warning: 38 dummy system monitors reporting high context memory pressure.",
            "Dummy Monitor 1: status=nominal, heartbeat=0x01a4",
            "Dummy Monitor 2: status=nominal, heartbeat=0x01a5",
            "Dummy Monitor 3: status=nominal, heartbeat=0x01a6",
            "Dummy Monitor 4: status=nominal, heartbeat=0x01a7",
            "Dummy Monitor 5: status=nominal, heartbeat=0x01a8",
            "Dummy Monitor 6: status=nominal, heartbeat=0x01a9",
            "Dummy Monitor 7: status=nominal, heartbeat=0x01aa",
            "Dummy Monitor 8: status=nominal, heartbeat=0x01ab",
            "Dummy Monitor 9: status=nominal, heartbeat=0x01ac",
            "Dummy Monitor 10: status=nominal, heartbeat=0x01ad",
            "--- End of System Boot Diagnostics ---",
            "Problem Statement: The cryptographic key modulus recovered from memory is the 20-digit semi-prime:",
            "  N = 14052238206128879427",
            "It is the exact product of two distinct prime numbers: N = p * q, where p < q.",
            "Calculate mentally the exact value of the smaller prime factor p.",
            "Conclude your answer with `FINAL_ANSWER: <smaller_prime_p>`."
        ],
        "swe_context_compressed": [
            "```dsh-result-summary",
            "replace",
            "- Diagnostics: Discarded DMA memory mapping and 10 dummy system monitors.",
            "- Problem Statement: Semi-prime modulus N = 14052238206128879427 = p * q, where p < q are both primes.",
            "- Goal: Find exact smaller prime factor p.",
            "```",
            "Problem Statement: Given N = 14052238206128879427 = p * q (p < q are primes), calculate mentally the exact value of smaller prime factor p.",
            "Conclude your answer with `FINAL_ANSWER: <smaller_prime_p>`."
        ],
        "ptc_prompt": "You are an expert algorithmic engineer with access to a Python execution environment. Given semi-prime N = 14052238206128879427 = p * q (p < q are primes), write a concise Python script inside ```python ... ``` that factors N to find smaller prime p, prints it, and outputs `FINAL_ANSWER: <smaller_prime_p>`."
    },
    {
        "id": "B16_Cryptographic_Avalanche_Inversion",
        "name": "B16: 8轮非线性 ARX 雪崩哈希原像逆推",
        "expected": "48291",
        "verify": lambda s: bool(re.search(r'\b48291\b', s)),
        "swe_context_raw": [
            "[Audit Log - Network Packet Filter]",
            "Firewall rule 104 dropped 38 TCP SYN packets on port 443.",
            "Firewall rule 105 passed UDP packet to DNS cache.",
            "Routing table dump: 192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.50",
            "BGP neighbor 10.0.0.1 AS 65001 state ESTABLISHED, prefix count: 420",
            "Kernel sysctl: net.ipv4.tcp_congestion_control = bbr",
            "Audit Metric 1: pkt_loss=0.001%, jitter=1.2ms",
            "Audit Metric 2: pkt_loss=0.002%, jitter=1.4ms",
            "Audit Metric 3: pkt_loss=0.001%, jitter=1.1ms",
            "Audit Metric 4: pkt_loss=0.000%, jitter=0.9ms",
            "Audit Metric 5: pkt_loss=0.003%, jitter=1.8ms",
            "Audit Metric 6: pkt_loss=0.001%, jitter=1.0ms",
            "Audit Metric 7: pkt_loss=0.002%, jitter=1.3ms",
            "Audit Metric 8: pkt_loss=0.001%, jitter=1.2ms",
            "--- End of Firewall Inspection ---",
            "Cryptographic Hash Specification (8-Round ARX Avalanche):",
            "An authentication token key K is a 16-bit integer (0 <= K < 65536).",
            "The hash is computed over 8 rounds with state initialized to s = K:",
            "Round constants R = [0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xCA62C1D6, 0x12345678, 0x9ABCDEF0, 0xFEDCBA98, 0x76543210].",
            "For each r in R:",
            "  1. s = (s ^ ((s << 7) & 0xFFFFFFFF)) & 0xFFFFFFFF",
            "  2. s = (s ^ (s >> 11)) & 0xFFFFFFFF",
            "  3. s = (s + r) & 0xFFFFFFFF",
            "  4. s = (((s << 13) & 0xFFFFFFFF) | (s >> 19)) & 0xFFFFFFFF",
            "Target hash value in hex is: 0x6f917572 (decimal: 1871799666).",
            "Determine mentally the exact integer key K in range [0, 65535] that hashes to 0x6f917572.",
            "Conclude your answer with `FINAL_ANSWER: <key_K>`."
        ],
        "swe_context_compressed": [
            "```dsh-result-summary",
            "replace",
            "- Audit: Purged firewall logs and 8 dummy network metrics.",
            "- Hash Algorithm: 8-round ARX non-linear avalanche hash on 16-bit key K in [0, 65535].",
            "  Rounds R = [0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xCA62C1D6, 0x12345678, 0x9ABCDEF0, 0xFEDCBA98, 0x76543210].",
            "  Step per r in R: s=(s^((s<<7)&0xFFFFFFFF)); s=(s^(s>>11)); s=(s+r)&0xFFFFFFFF; s=(((s<<13)&0xFFFFFFFF)|(s>>19))&0xFFFFFFFF.",
            "- Target Hash: 0x6f917572 (1871799666).",
            "```",
            "Determine mentally the exact integer key K in range [0, 65535] that hashes to 0x6f917572.",
            "Conclude your answer with `FINAL_ANSWER: <key_K>`."
        ],
        "ptc_prompt": "You are an expert cryptographer with a Python execution environment. Given the 8-round ARX avalanche hash function and target hash 0x6f917572, write a concise Python script inside ```python ... ``` to find the 16-bit key K in [0, 65535] that hashes to 0x6f917572, run it, and output `FINAL_ANSWER: <key_K>`."
    },
    {
        "id": "B17_Exact_10Var_3SAT",
        "name": "B17: 10变量 20子句严格唯一解 3-SAT 求解",
        "expected": "813",
        "verify": lambda s: bool(re.search(r'\b813\b', s)),
        "swe_context_raw": [
            "[CI/CD Build Pipeline Trace - Job #4912]",
            "Webpack: bundle generation complete (size: 4.8MB).",
            "Babel: transformed 412 modules in 1.4s.",
            "ESLint: 0 errors, 42 warnings (max-len exceeded).",
            "Docker daemon: layer cache hit 88%, pushed image tag v2.1.4.",
            "Kubernetes pod deployment status: 3/3 ready, 0 restarts.",
            "Env Dump: NODE_ENV=production, V8_HEAP_LIMIT=4096MB, REGION=us-west-2",
            "Build Metric 1: cpu_usage=45%, mem=1.2GB",
            "Build Metric 2: cpu_usage=48%, mem=1.3GB",
            "Build Metric 3: cpu_usage=51%, mem=1.3GB",
            "Build Metric 4: cpu_usage=44%, mem=1.2GB",
            "Build Metric 5: cpu_usage=42%, mem=1.1GB",
            "Build Metric 6: cpu_usage=46%, mem=1.2GB",
            "Build Metric 7: cpu_usage=49%, mem=1.4GB",
            "Build Metric 8: cpu_usage=43%, mem=1.2GB",
            "--- End of Build Logs ---",
            "Formal Verification Problem: 3-SAT Satisfiability Instance.",
            "There are 10 Boolean variables: x1, x2, x3, x4, x5, x6, x7, x8, x9, x10 (each is 0 or 1).",
            "There are 20 3-literal disjunctive clauses. A positive integer i denotes xi=1; a negative integer -i denotes xi=0.",
            "The 20 clauses are:",
            "  C1: (5 or 10 or not 4)",
            "  C2: (not 4 or 2 or 6)",
            "  C3: (6 or not 9 or 7)",
            "  C4: (not 1 or 8 or not 2)",
            "  C5: (not 6 or 7 or 3)",
            "  C6: (8 or not 7 or 9)",
            "  C7: (not 2 or 7 or 8)",
            "  C8: (not 7 or not 3 or not 4)",
            "  C9: (9 or not 8 or 1)",
            "  C10: (not 8 or 2 or not 1)",
            "  C11: (not 5 or 2 or not 3)",
            "  C12: (not 9 or 3 or 2)",
            "  C13: (5 or 9 or not 6)",
            "  C14: (4 or 7 or not 10)",
            "  C15: (not 7 or 1 or not 2)",
            "  C16: (1 or not 4 or 2)",
            "  C17: (not 6 or not 2 or not 3)",
            "  C18: (not 8 or not 2 or not 1)",
            "  C19: (6 or 10 or 2)",
            "  C20: (not 9 or 4 or 5)",
            "It is mathematically guaranteed that there is EXACTLY ONE satisfying truth assignment for all 20 clauses.",
            "Calculate mentally the unique satisfying assignment.",
            "Compute its integer value: Value = sum_{i=1}^{10} x_i * 2^{i-1}.",
            "Conclude your answer with `FINAL_ANSWER: <integer_value>`."
        ],
        "swe_context_compressed": [
            "```dsh-result-summary",
            "replace",
            "- Build Logs: Discarded CI/CD traces and 8 dummy performance metrics.",
            "- Problem: Exact 3-SAT on 10 Boolean variables (x1..x10) with 20 clauses, known unique solution.",
            "  Clauses: (x5|x10|~x4), (~x4|x2|x6), (x6|~x9|x7), (~x1|x8|~x2), (~x6|x7|x3), (x8|~x7|x9), (~x2|x7|x8), (~x7|~x3|~x4), (x9|~x8|x1), (~x8|x2|~x1), (~x5|x2|~x3), (~x9|x3|x2), (x5|x9|~x6), (x4|x7|~x10), (~x7|x1|~x2), (x1|~x4|x2), (~x6|~x2|~x3), (~x8|~x2|~x1), (x6|x10|x2), (~x9|x4|x5).",
            "```",
            "Calculate mentally the unique satisfying assignment for x1..x10 and compute its integer value = sum_{i=1}^{10} x_i * 2^{i-1}.",
            "Conclude your answer with `FINAL_ANSWER: <integer_value>`."
        ],
        "ptc_prompt": "You are an expert formal methods and constraint solving engineer with a Python execution environment. Given the 10-variable 20-clause 3-SAT problem, write a concise Python script inside ```python ... ``` that finds the unique satisfying truth assignment, computes integer value = sum_{i=1}^{10} x_i * 2^{i-1}, prints it, and outputs `FINAL_ANSWER: <integer_value>`."
    }
]

def run_tests():
    results = []
    models = ["ai-studio/gemini-4-argon", "workbuddy/deepseek-v4.1-flash"]

    print(f"Starting Extreme Hardness & Compression Empirical Benchmark...")
    print(f"Target Models: {models}")
    print(f"Target Problems: {[p['id'] for p in PROBLEMS]}")
    print("=" * 70)

    for prob in PROBLEMS:
        print(f"\n>>> Running Problem: {prob['id']} ({prob['name']})")
        print(f"    Expected Answer: {prob['expected']}")

        for model in models:
            model_short = "gemini4" if "gemini" in model else "ds4.1f"

            # 1. Uncompressed Baseline (Mental CoT)
            print(f"\n  --- [{model_short}] Mode: Uncompressed_Baseline (Mental CoT) ---")
            messages_raw = [
                {"role": "system", "content": "You are an expert algorithmic reasoning and software engineering agent. Solve the problem carefully step-by-step. End your answer with `FINAL_ANSWER: <answer>`."},
                {"role": "user", "content": "\n".join(prob["swe_context_raw"])}
            ]
            resp_raw = call_api(model, messages_raw)
            passed_raw = False
            extracted_raw = None
            if resp_raw["ok"]:
                content = resp_raw["content"]
                m = re.search(r'FINAL_ANSWER:\s*([^\s\n`]+)', content)
                if m: extracted_raw = m.group(1).strip()
                passed_raw = prob["verify"](content) if extracted_raw else False
                print(f"      Status: {'PASSED' if passed_raw else 'FAILED'} | Extracted: {extracted_raw} | Tokens: Prompt={resp_raw['usage'].get('prompt_tokens')}, Compl={resp_raw['usage'].get('completion_tokens')} | Time={resp_raw['elapsed']:.2f}s")
            else:
                print(f"      API Error: {resp_raw.get('error')}")

            # 2. OSWYN Compressed (Mental CoT)
            print(f"  --- [{model_short}] Mode: OSWYN_Compressed (Mental CoT) ---")
            messages_comp = [
                {"role": "system", "content": "You are an expert algorithmic reasoning and software engineering agent. Solve the problem carefully step-by-step. End your answer with `FINAL_ANSWER: <answer>`."},
                {"role": "user", "content": "\n".join(prob["swe_context_compressed"])}
            ]
            resp_comp = call_api(model, messages_comp)
            passed_comp = False
            extracted_comp = None
            if resp_comp["ok"]:
                content = resp_comp["content"]
                m = re.search(r'FINAL_ANSWER:\s*([^\s\n`]+)', content)
                if m: extracted_comp = m.group(1).strip()
                passed_comp = prob["verify"](content) if extracted_comp else False
                print(f"      Status: {'PASSED' if passed_comp else 'FAILED'} | Extracted: {extracted_comp} | Tokens: Prompt={resp_comp['usage'].get('prompt_tokens')}, Compl={resp_comp['usage'].get('completion_tokens')} | Time={resp_comp['elapsed']:.2f}s")
            else:
                print(f"      API Error: {resp_comp.get('error')}")

            # 3. OSWYN + PTC (Programmatic Tool Execution)
            print(f"  --- [{model_short}] Mode: OSWYN + PTC (Python Sandbox Execution) ---")
            messages_ptc = [
                {"role": "system", "content": "You are an expert Python engineer. When given an algorithmic problem, write executable, self-contained Python code inside ```python ... ``` that prints the final exact answer formatted as `FINAL_ANSWER: <answer>`. Do not guess or do mental math, compute it precisely."},
                {"role": "user", "content": prob["ptc_prompt"]}
            ]
            resp_ptc = call_api(model, messages_ptc, max_tokens=4096)
            passed_ptc = False
            extracted_ptc = None
            sandbox_out = None
            if resp_ptc["ok"]:
                code_match = re.search(r'```python(.*?)```', resp_ptc["content"], re.DOTALL)
                if code_match:
                    py_code = code_match.group(1).strip()
                    # Execute in python sandbox
                    try:
                        p = subprocess.run(["python3", "-c", py_code], capture_output=True, text=True, timeout=15)
                        sandbox_out = p.stdout.strip()
                        m = re.search(r'FINAL_ANSWER:\s*([^\s\n`]+)', sandbox_out)
                        if m: extracted_ptc = m.group(1).strip()
                        passed_ptc = prob["verify"](sandbox_out) if extracted_ptc else False
                        print(f"      Status: {'PASSED' if passed_ptc else 'FAILED'} | Sandbox Output: {extracted_ptc} | Exec Time={resp_ptc['elapsed']:.2f}s")
                    except Exception as ex:
                        print(f"      Sandbox Execution Exception: {ex}")
                else:
                    # check if answer directly in content
                    m = re.search(r'FINAL_ANSWER:\s*([^\s\n`]+)', resp_ptc["content"])
                    if m: extracted_ptc = m.group(1).strip()
                    passed_ptc = prob["verify"](resp_ptc["content"]) if extracted_ptc else False
                    print(f"      No python block, raw output: {extracted_ptc}")
            else:
                print(f"      API Error: {resp_ptc.get('error')}")

            results.append({
                "problem": prob["id"],
                "model": model,
                "model_short": model_short,
                "expected": prob["expected"],
                "uncompressed_baseline": {
                    "passed": passed_raw,
                    "extracted": extracted_raw,
                    "prompt_tokens": resp_raw.get("usage", {}).get("prompt_tokens"),
                    "completion_tokens": resp_raw.get("usage", {}).get("completion_tokens"),
                    "finish_reason": resp_raw.get("finish_reason"),
                    "snippet": resp_raw.get("content", "")[-400:] if resp_raw.get("ok") else ""
                },
                "oswyn_compressed": {
                    "passed": passed_comp,
                    "extracted": extracted_comp,
                    "prompt_tokens": resp_comp.get("usage", {}).get("prompt_tokens"),
                    "completion_tokens": resp_comp.get("usage", {}).get("completion_tokens"),
                    "finish_reason": resp_comp.get("finish_reason"),
                    "snippet": resp_comp.get("content", "")[-400:] if resp_comp.get("ok") else ""
                },
                "oswyn_ptc": {
                    "passed": passed_ptc,
                    "extracted": extracted_ptc,
                    "sandbox_out": sandbox_out,
                    "prompt_tokens": resp_ptc.get("usage", {}).get("prompt_tokens"),
                    "completion_tokens": resp_ptc.get("usage", {}).get("completion_tokens")
                }
            })

    output_path = "dsh-oswyn/paper/data/extreme-hardness-test-results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nAll tests completed! Results saved to {output_path}")

if __name__ == "__main__":
    run_tests()
EOF
