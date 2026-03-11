"""
freestyle.py — The Wizard
─────────────────────────
A lightweight LLM pipeline orchestrator that reads TOML pipeline
definitions and executes them against any Ollama-compatible backend.

Usage:
    python freestyle.py pipeline.toml
    echo "some text" | python freestyle.py pipeline.toml
    python freestyle.py pipeline.toml --input "some text"
    python freestyle.py --example          # writes example.toml and runs it

Philosophy:
    Pipelines are email threads. Models are correspondents.
    Text is the only currency. The Wizard just delivers the mail.
"""

import sys
import os
import json
import tomllib
import argparse
import httpx
import tempfile
import textwrap
from typing import Any
from collections import defaultdict


# ── CONFIG ────────────────────────────────────────────────────────────────────

OLLAMA_BASE    = os.environ.get("OLLAMA_BASE", "http://localhost:11434")
OPENAI_BASE    = os.environ.get("OPENAI_BASE", "")       # optional override
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DEFAULT_MODEL  = os.environ.get("FREESTYLE_MODEL", "qwen3:0.6b")
DEFAULT_TEMP   = 0.7
SCHEMA_VERSION = "0.1"


# ── COLORS (terminal) ─────────────────────────────────────────────────────────

class C:
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    DIM    = "\033[2m"
    CYAN   = "\033[36m"
    YELLOW = "\033[33m"
    GREEN  = "\033[32m"
    RED    = "\033[31m"
    MAGENTA= "\033[35m"

def dim(s):    return f"{C.DIM}{s}{C.RESET}"
def bold(s):   return f"{C.BOLD}{s}{C.RESET}"
def cyan(s):   return f"{C.CYAN}{s}{C.RESET}"
def yellow(s): return f"{C.YELLOW}{s}{C.RESET}"
def green(s):  return f"{C.GREEN}{s}{C.RESET}"
def red(s):    return f"{C.RED}{s}{C.RESET}"
def magenta(s):return f"{C.MAGENTA}{s}{C.RESET}"

def banner():
    print(f"""
{cyan('┌─────────────────────────────────────┐')}
{cyan('│')}  {bold('✦ freestyle wizard')} {dim('v' + SCHEMA_VERSION)}              {cyan('│')}
{cyan('│')}  {dim('text flows. models listen.')}          {cyan('│')}
{cyan('└─────────────────────────────────────┘')}
""")

def log(icon, label, msg, color=C.CYAN):
    label_str = f"{color}{label}{C.RESET}"
    print(f"  {icon}  {label_str}: {dim(msg)}")

def log_output(lens_id, text):
    preview = text.strip().replace("\n", " ")[:120]
    if len(text.strip()) > 120:
        preview += "…"
    print(f"\n  {green('▶')} {bold(lens_id)}\n  {dim('└──')} {preview}\n")


# ── MODEL CALLER ──────────────────────────────────────────────────────────────

def call_model(model: str, system: str, user: str, temperature: float = DEFAULT_TEMP) -> str:
    """
    Call a model via Ollama's OpenAI-compatible endpoint.
    Falls back to raw Ollama /api/chat if needed.
    Supports OPENAI_BASE override for non-Ollama backends.
    """
    base = OPENAI_BASE if OPENAI_BASE else f"{OLLAMA_BASE}/v1"
    headers = {"Content-Type": "application/json"}
    if OPENAI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENAI_API_KEY}"

    payload = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ]
    }

    try:
        r = httpx.post(f"{base}/chat/completions", json=payload, headers=headers, timeout=120)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        # Fallback: raw Ollama endpoint
        try:
            payload2 = {
                "model": model,
                "stream": False,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ]
            }
            r2 = httpx.post(f"{OLLAMA_BASE}/api/chat", json=payload2, timeout=120)
            r2.raise_for_status()
            return r2.json()["message"]["content"].strip()
        except Exception as e2:
            raise RuntimeError(f"Model call failed ({model}): {e} / fallback: {e2}")


# ── MERGE STRATEGIES ─────────────────────────────────────────────────────────

def merge_inputs(inputs: dict[str, str], strategy: str = "concat") -> str:
    """
    Combine multiple upstream outputs into a single user message.

    concat      — join with double newline (default)
    interleave  — alternate lines from each source
    xml_tagged  — wrap each in <source id="..."> tags (best for models that
                  need to distinguish inputs clearly)
    """
    if strategy == "xml_tagged":
        return "\n".join(f'<source id="{k}">\n{v}\n</source>' for k, v in inputs.items())
    elif strategy == "interleave":
        lines = []
        iters = [iter(v.splitlines()) for v in inputs.values()]
        while any(True for it in iters):
            new_iters = []
            for it in iters:
                try:
                    lines.append(next(it))
                    new_iters.append(it)
                except StopIteration:
                    pass
            iters = new_iters
        return "\n".join(lines)
    else:  # concat (default)
        return "\n\n".join(f"[{k}]\n{v}" for k, v in inputs.items())


# ── GRAPH RESOLVER ────────────────────────────────────────────────────────────

def build_graph(lenses: list[dict]) -> dict[str, list[str]]:
    """
    Build adjacency list: node → [nodes that depend on it].
    Used for topological sort.
    """
    graph = defaultdict(list)
    for lens in lenses:
        lid = lens["id"]
        frm = lens.get("from", "source")
        if isinstance(frm, str):
            graph[frm].append(lid)
        else:
            for f in frm:
                graph[f].append(lid)
    return graph


def topological_sort(lenses: list[dict]) -> list[dict]:
    """
    Kahn's algorithm. Returns lenses in execution order.
    Raises on cycles (which would be genuinely insane pipelines).
    """
    ids    = {l["id"] for l in lenses}
    indeg  = defaultdict(int)
    deps   = {}  # lens_id → set of upstream ids that must complete first

    for lens in lenses:
        frm = lens.get("from", "source")
        upstream = {frm} if isinstance(frm, str) else set(frm)
        # Only count real lens dependencies (not 'source')
        real_upstream = upstream & ids
        deps[lens["id"]] = real_upstream
        indeg[lens["id"]] = len(real_upstream)

    queue  = [l for l in lenses if indeg[l["id"]] == 0]
    result = []

    while queue:
        node = queue.pop(0)
        result.append(node)
        for lens in lenses:
            if node["id"] in deps[lens["id"]]:
                deps[lens["id"]].discard(node["id"])
                indeg[lens["id"]] -= 1
                if indeg[lens["id"]] == 0:
                    queue.append(lens)

    if len(result) != len(lenses):
        raise ValueError("Pipeline contains a cycle — check your 'from' fields.")

    return result


# ── SOURCE RESOLVER ──────────────────────────────────────────────────────────

def resolve_source(source_cfg: dict, cli_input: str | None) -> str:
    if cli_input is not None:
        return cli_input

    stype = source_cfg.get("type", "stdin")

    if stype == "text":
        return source_cfg["text"]

    elif stype == "file":
        path = source_cfg["path"]
        with open(path) as f:
            return f.read()

    elif stype == "http":
        r = httpx.get(source_cfg["url"], timeout=30)
        r.raise_for_status()
        return r.text

    else:  # stdin
        if sys.stdin.isatty():
            print(dim("  ┌ Enter input (Ctrl+D to finish):"))
        return sys.stdin.read()


# ── SINK HANDLER ─────────────────────────────────────────────────────────────

def handle_sink(sink_cfg: dict, text: str):
    stype = sink_cfg.get("type", "stdout")

    if stype == "stdout":
        print(f"\n{bold('═' * 50)}")
        print(bold("  FINAL OUTPUT"))
        print(bold('═' * 50))
        print(text)
        print(bold('═' * 50) + "\n")

    elif stype == "file":
        path = sink_cfg["path"]
        mode = "a" if path.endswith(".jsonl") else "w"
        with open(path, mode) as f:
            if path.endswith(".jsonl"):
                f.write(json.dumps({"output": text}) + "\n")
            else:
                f.write(text)
        log("💾", "saved", path, C.GREEN)

    elif stype == "http":
        method = sink_cfg.get("method", "POST").upper()
        url    = sink_cfg["url"]
        r = httpx.request(method, url, content=text, timeout=30)
        log("📡", "http sink", f"{method} {url} → {r.status_code}", C.YELLOW)


# ── GATE ROUTER ──────────────────────────────────────────────────────────────

def resolve_gate(lens: dict, output: str, outputs: dict[str, str]) -> str | None:
    """
    Gate lenses emit a route key. The Wizard uses it to select
    which downstream lens actually runs next (others are skipped).
    Returns the winning lens id, or None if _default applies.
    """
    routes  = lens.get("routes", {})
    key     = output.strip().lower().split()[0]  # first word only
    target  = routes.get(key, routes.get("_default"))
    if target:
        log("🔀", "gate", f"'{key}' → {target}", C.MAGENTA)
    return target


# ── SPAWN HANDLER ─────────────────────────────────────────────────────────────

def spawn_pipeline(toml_text: str, source_text: str, depth: int = 0):
    """
    Recursively instantiate and run a sub-pipeline from TOML text.
    depth is a safety guard against runaway recursion.
    """
    if depth > 5:
        log("⚠️", "spawn", "max recursion depth reached (5)", C.RED)
        return

    log("✨", "spawn", f"instantiating sub-pipeline (depth {depth+1})", C.MAGENTA)

    try:
        cfg = tomllib.loads(toml_text)
    except Exception as e:
        log("✗", "spawn", f"invalid TOML from model: {e}", C.RED)
        return

    run_pipeline(cfg, cli_input=source_text, depth=depth + 1)


# ── WIZARD: CORE EXECUTION ────────────────────────────────────────────────────

def run_pipeline(cfg: dict, cli_input: str | None = None, depth: int = 0):
    pipe_name = cfg.get("pipeline", {}).get("name", "unnamed")
    indent    = "  " * depth

    if depth == 0:
        banner()

    print(f"{indent}{cyan('pipeline:')} {bold(pipe_name)}")
    if desc := cfg.get("pipeline", {}).get("description"):
        print(f"{indent}{dim('  ' + desc)}")
    print()

    # ── Resolve source
    source_text = resolve_source(cfg.get("source", {}), cli_input)
    log("📥", "source", f"{len(source_text)} chars", C.CYAN)

    lenses  = cfg.get("lens", [])
    sinks   = cfg.get("sink", [])
    outputs = {"source": source_text}

    # ── Build execution order
    sorted_lenses = topological_sort(lenses)
    skipped       = set()   # gate-skipped lens ids

    # ── Execute each lens
    for lens in sorted_lenses:
        lid         = lens["id"]
        model       = lens.get("model", DEFAULT_MODEL)
        system      = lens.get("system", "You are a helpful assistant.")
        temperature = lens.get("temperature", DEFAULT_TEMP)
        is_bcc      = lens.get("bcc", False)
        is_gate     = lens.get("gate", False)
        emit        = lens.get("emit", None)
        spawn       = lens.get("spawn", False)
        merge_strat = lens.get("merge_strategy", "concat")
        frm         = lens.get("from", "source")

        # Skip if a gate routed away from this lens
        if lid in skipped:
            log("⏭", lid, "skipped (gate)", C.DIM)
            continue

        # Check all upstream inputs are available
        upstream_ids = [frm] if isinstance(frm, str) else frm
        missing = [u for u in upstream_ids if u not in outputs]
        if missing:
            log("⚠️", lid, f"upstream not ready: {missing} — skipping", C.RED)
            continue

        # Assemble user message
        if isinstance(frm, str):
            user_text = outputs[frm]
        else:
            user_text = merge_inputs(
                {u: outputs[u] for u in frm},
                strategy=merge_strat
            )

        icon = "👻" if is_bcc else ("🔀" if is_gate else "🔮")
        log(icon, lid, f"{model} @ temp={temperature}", C.CYAN)

        # Call the model
        try:
            result = call_model(model, system, user_text, temperature)
        except RuntimeError as e:
            log("✗", lid, str(e), C.RED)
            outputs[lid] = f"[ERROR: {e}]"
            continue

        outputs[lid] = result
        if not is_bcc:
            log_output(lid, result)

        # ── Gate: mark losing branches as skipped
        if is_gate:
            winning_id = resolve_gate(lens, result, outputs)
            routes     = lens.get("routes", {})
            all_targets = set(routes.values())
            for loser in all_targets:
                if loser != winning_id:
                    skipped.add(loser)

        # ── Spawn: treat output as a sub-pipeline TOML
        if emit == "toml" and spawn:
            spawn_pipeline(result, source_text, depth=depth)

        # ── BCC: route to named sink immediately
        if is_bcc:
            sink_id   = lens.get("sink_id")
            bcc_sinks = [s for s in sinks if s.get("id") == sink_id]
            for s in bcc_sinks:
                handle_sink(s, result)

    # ── Handle sinks
    non_bcc_sink_ids = {lens.get("sink_id") for lens in lenses if lens.get("bcc")}
    for sink in sinks:
        if sink.get("id") in non_bcc_sink_ids:
            continue   # already handled by BCC lens
        from_id = sink.get("from")
        if from_id in outputs:
            handle_sink(sink, outputs[from_id])
        else:
            log("⚠️", "sink", f"source lens '{from_id}' has no output", C.YELLOW)

    # ── If no sinks defined, print the last non-BCC output
    if not sinks:
        last = None
        for lens in reversed(sorted_lenses):
            if not lens.get("bcc") and lens["id"] in outputs:
                last = lens["id"]
                break
        if last:
            print(f"\n{bold('═' * 50)}")
            print(bold("  OUTPUT"))
            print(bold('═' * 50))
            print(outputs[last])
            print(bold('═' * 50) + "\n")


# ── EXAMPLE PIPELINE ─────────────────────────────────────────────────────────

EXAMPLE_TOML = '''\
[pipeline]
name        = "hello_freestyle"
version     = "0.1"
description = "A simple two-lens demo: summarize then critique."
author      = "wizard"

[source]
type = "text"
text = """
The mitochondria is the powerhouse of the cell. It produces ATP through
oxidative phosphorylation. Recent research suggests mitochondria also play
roles in apoptosis, calcium signaling, and heat production.
"""

[[lens]]
id          = "summarizer"
model       = "qwen3:0.6b"
system      = "You write precise one-sentence summaries. Reply with the summary only."
from        = "source"
temperature = 0.3

[[lens]]
id          = "critic"
model       = "qwen3:0.6b"
system      = "You are a peer reviewer. In one sentence, identify the most important omission in this summary."
from        = "summarizer"
temperature = 0.5

[[lens]]
id          = "final"
model       = "qwen3:0.6b"
system      = "You are an editor. Incorporate the critique into a single improved sentence."
from        = ["summarizer", "critic"]
merge_strategy = "xml_tagged"
temperature = 0.4

[[sink]]
id   = "out"
type = "stdout"
from = "final"
'''


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="freestyle",
        description="The Wizard — freestyle pipeline orchestrator"
    )
    parser.add_argument("pipeline", nargs="?",         help="Path to .toml pipeline file")
    parser.add_argument("--input",  "-i", default=None, help="Input text (overrides source)")
    parser.add_argument("--example",      action="store_true", help="Write and run example.toml")
    parser.add_argument("--dry-run",      action="store_true", help="Parse and print graph, no model calls")
    parser.add_argument("--ollama-base",  default=None, help="Override Ollama base URL")
    args = parser.parse_args()

    global OLLAMA_BASE
    if args.ollama_base:
        OLLAMA_BASE = args.ollama_base

    # ── Example mode
    if args.example:
        with open("example.toml", "w") as f:
            f.write(EXAMPLE_TOML)
        print(dim("  wrote example.toml"))
        cfg = tomllib.loads(EXAMPLE_TOML)
        run_pipeline(cfg)
        return

    if not args.pipeline:
        parser.print_help()
        sys.exit(1)

    with open(args.pipeline, "rb") as f:
        cfg = tomllib.load(f)

    # ── Dry run: just show the graph
    if args.dry_run:
        banner()
        lenses = cfg.get("lens", [])
        print(bold("  execution graph:"))
        for lens in topological_sort(lenses):
            frm   = lens.get("from", "source")
            flags = []
            if lens.get("bcc"):    flags.append("bcc")
            if lens.get("gate"):   flags.append("gate")
            if lens.get("spawn"):  flags.append("spawn")
            flag_str = f"  {dim('[' + ', '.join(flags) + ']')}" if flags else ""
            print(f"    {cyan(str(frm))} → {bold(lens['id'])} {dim('(' + lens.get('model', DEFAULT_MODEL) + ')')}{flag_str}")
        print()
        return

    # ── Normal run
    cli_input = args.input
    if not cli_input and not sys.stdin.isatty():
        cli_input = sys.stdin.read()

    run_pipeline(cfg, cli_input=cli_input)


if __name__ == "__main__":
    main()
