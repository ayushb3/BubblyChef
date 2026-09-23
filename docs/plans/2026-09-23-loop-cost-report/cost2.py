"""Extends loop_cost.py with per-model $ pricing, per-stage and per-bucket rollups.
Prices $/MTok: (input, cache_write_5m, cache_read, output)."""
import json, sys, collections, re
from datetime import datetime
from pathlib import Path

PRICES = {
    "opus-5-5": (4.0, 5.0, 0.20, 20.0),
    "opus-5": (5.0, 6.25, 0.50, 25.0),
    "sonnet-5": (2.0, 2.5, 0.20, 10.0),
    "haiku-4-5": (1.0, 1.25, 0.10, 5.0),
}

def price_key(model):
    m = model.replace("claude-", "")
    for k in ("opus-5-5", "opus-5", "sonnet-5", "haiku-4-5"):
        if m.startswith(k):
            return k
    return None

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def bucket(label):
    l = label.lower()
    if l in ("capability", "preflight"): return "Preflight"
    if l.startswith("setup"): return "Setup"
    if l == "plan": return "Plan"
    if l.startswith("decide") or l.startswith("dry-run"): return "Decide"
    if l.startswith("reproduce"): return "Reproduce"
    if l.startswith("implement"): return "Implement"
    if l.startswith("verify"): return "Verify"
    if l.startswith("review"): return "Review"
    if l.startswith("fix"): return "Fix(review)"
    if l in ("ship", "escalate", "blocked-path"): return "Ship"
    if l.startswith("gh-review"): return "Respond(read)"
    if l.startswith("respond-fix"): return "Respond(fix)"
    if l.startswith("finish") or l.startswith("undo"): return "Finish"
    return "Other:" + label

def agent(meta_path):
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    tr = meta_path.with_name(meta_path.name.replace(".meta.json", ".jsonl"))
    usage = {}
    model_of = {}
    times = []
    tools = collections.Counter()
    if tr.exists():
        for line in tr.read_text(encoding="utf-8").splitlines():
            try: d = json.loads(line)
            except Exception: continue
            if d.get("timestamp"): times.append(ts(d["timestamp"]))
            m = d.get("message")
            if not isinstance(m, dict): continue
            if m.get("usage") and m.get("id"):
                usage[m["id"]] = m["usage"]; model_of[m["id"]] = m.get("model", "")
            for b in m.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use": tools[b.get("name")] += 1
    u = collections.Counter(); cost = 0.0
    models = set()
    for mid, us in usage.items():
        k = price_key(model_of[mid] or "")
        models.add(k)
        i, cw, cr, o = (us.get("input_tokens") or 0, us.get("cache_creation_input_tokens") or 0,
                        us.get("cache_read_input_tokens") or 0, us.get("output_tokens") or 0)
        u["input"] += i; u["cw"] += cw; u["cr"] += cr; u["out"] += o
        if k:
            p = PRICES[k]
            c = (i*p[0] + cw*p[1] + cr*p[2] + o*p[3]) / 1e6
            cost += c
            u["$in"] += i*p[0]/1e6; u["$cw"] += cw*p[1]/1e6; u["$cr"] += cr*p[2]/1e6; u["$out"] += o*p[3]/1e6
    return dict(label=meta.get("description", "?"), phase=meta.get("workflowPhase", "?"),
                agentType=meta.get("agentType"), models=",".join(sorted(x or "?" for x in models)),
                calls=len(usage), start=min(times) if times else None, end=max(times) if times else None,
                secs=(max(times)-min(times)).total_seconds() if times else 0, cost=cost, tools=tools, **u)

def run(d):
    d = Path(d)
    ags = [agent(p) for p in d.glob("agent-*.meta.json")]
    ags = [a for a in ags if a["start"]]
    ags.sort(key=lambda a: a["start"])
    return ags

if __name__ == "__main__":
    out = {}
    for name, d in [a.split("=", 1) for a in sys.argv[1:]]:
        ags = run(d)
        tot = collections.Counter()
        for a in ags:
            for k in ("input", "cw", "cr", "out", "cost", "$in", "$cw", "$cr", "$out", "calls"): tot[k] += a.get(k, 0)
        wall = (max(a["end"] for a in ags) - min(a["start"] for a in ags)).total_seconds()
        # active time = union of agent intervals
        iv = sorted((a["start"], a["end"]) for a in ags); active = 0; cs, ce = iv[0]
        for s, e in iv[1:]:
            if s > ce: active += (ce-cs).total_seconds(); cs, ce = s, e
            else: ce = max(ce, e)
        active += (ce-cs).total_seconds()
        stages = collections.defaultdict(collections.Counter)
        for a in ags:
            b = bucket(a["label"])
            for k in ("input", "cw", "cr", "out", "cost", "secs"): stages[b][k] += a.get(k, 0)
            stages[b]["n"] += 1
        out[name] = dict(n=len(ags), wall=wall, active=active, start=min(a["start"] for a in ags).isoformat(),
                         end=max(a["end"] for a in ags).isoformat(), tot=dict(tot),
                         stages={k: dict(v) for k, v in stages.items()},
                         agents=[dict(label=a["label"], phase=a["phase"], models=a["models"], type=a["agentType"], calls=a["calls"],
                                      secs=round(a["secs"]), cost=round(a["cost"], 3), cr=a.get("cr",0), cw=a.get("cw",0), out=a.get("out",0),
                                      start=a["start"].isoformat()) for a in ags])
    print(json.dumps(out, indent=1, default=str))
