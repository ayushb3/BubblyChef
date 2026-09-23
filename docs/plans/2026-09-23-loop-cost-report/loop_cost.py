"""Token and time breakdown for agent-loop workflow runs.

Reads each run's agent-*.meta.json (label, phase, model) and agent-*.jsonl transcript
(per-call usage + timestamps). Usage lines can repeat per message id while streaming,
so each message id is counted once, using its last reported usage.

usage: python loop_cost.py <run_dir> [<run_dir> ...]
"""
import json
import sys
import collections
from datetime import datetime
from pathlib import Path


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def agent_stats(meta_path):
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    tr = meta_path.with_name(meta_path.name.replace(".meta.json", ".jsonl"))
    usage_by_msg = {}
    models = collections.Counter()
    tools = collections.Counter()
    times = []
    for line in tr.read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        if d.get("timestamp"):
            times.append(ts(d["timestamp"]))
        m = d.get("message")
        if not isinstance(m, dict):
            continue
        if m.get("usage") and m.get("id"):
            usage_by_msg[m["id"]] = m["usage"]
            if m.get("model"):
                models[m["model"]] = 1
        for block in m.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                tools[block.get("name")] += 1
    u = collections.Counter()
    for us in usage_by_msg.values():
        u["input"] += us.get("input_tokens", 0) or 0
        u["cache_write"] += us.get("cache_creation_input_tokens", 0) or 0
        u["cache_read"] += us.get("cache_read_input_tokens", 0) or 0
        u["output"] += us.get("output_tokens", 0) or 0
    return {
        "label": meta.get("description", "?"),
        "phase": meta.get("workflowPhase", "?"),
        "model": (",".join(sorted(k.replace("claude-", "") for k in models)) or meta.get("model", "?")),
        "calls": len(usage_by_msg),
        "tools": tools,
        "secs": (max(times) - min(times)).total_seconds() if times else 0,
        "start": min(times) if times else None,
        "end": max(times) if times else None,
        **u,
    }


def fmt_k(n):
    return f"{n/1000:.1f}k"


def report(run_dir):
    run = Path(run_dir)
    agents = sorted((agent_stats(p) for p in run.glob("agent-*.meta.json")), key=lambda a: a["start"] or datetime.max)
    if not agents:
        print(f"\n{run.name}: no agents")
        return None
    wall = (max(a["end"] for a in agents) - min(a["start"] for a in agents)).total_seconds()
    tot = collections.Counter()
    for a in agents:
        for k in ("input", "cache_write", "cache_read", "output", "calls"):
            tot[k] += a[k]
    total_in = tot["input"] + tot["cache_write"] + tot["cache_read"]
    print(f"\n=== {run.name}: {len(agents)} agents, wall {wall/60:.1f} min ===")
    print(f"{'agent':<18}{'phase':<11}{'model':<8}{'calls':>6}{'secs':>7}{'in(fresh)':>11}{'cache_wr':>10}{'cache_rd':>10}{'out':>8}  top tools")
    for a in agents:
        top = ", ".join(f"{k}:{v}" for k, v in a["tools"].most_common(3))
        print(f"{a['label'][:17]:<18}{a['phase'][:10]:<11}{a['model'][:7]:<8}{a['calls']:>6}{a['secs']:>7.0f}"
              f"{fmt_k(a['input']):>11}{fmt_k(a['cache_write']):>10}{fmt_k(a['cache_read']):>10}{fmt_k(a['output']):>8}  {top}")
    print(f"{'TOTAL':<37}{tot['calls']:>6}{'':>7}{fmt_k(tot['input']):>11}{fmt_k(tot['cache_write']):>10}{fmt_k(tot['cache_read']):>10}{fmt_k(tot['output']):>8}")
    if total_in:
        print(f"  input processed {fmt_k(total_in)}, of which cache reads {100*tot['cache_read']/total_in:.0f}%; output {fmt_k(tot['output'])}")
    by_phase = collections.defaultdict(lambda: collections.Counter())
    for a in agents:
        p = by_phase[a["phase"]]
        p["secs"] += a["secs"]; p["tokens"] += a["input"] + a["cache_write"] + a["cache_read"] + a["output"]
        p["out"] += a["output"]
    grand = sum(p["tokens"] for p in by_phase.values()) or 1
    print("  by phase:", "; ".join(f"{ph} {100*p['tokens']/grand:.0f}% tok / {p['secs']:.0f}s" for ph, p in by_phase.items()))
    return {"run": run.name, "agents": agents, "wall": wall, "tot": tot}


if __name__ == "__main__":
    for d in sys.argv[1:]:
        report(d)
