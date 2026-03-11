"""
serve.py — HTTP wrapper around freestyle.py
Exposes the pipeline runner as a local API for the Playdesk GUI.
"""

import sys
import os
import json
import asyncio
import tomllib
import httpx

# Add parent dir so we can import freestyle
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware

import freestyle

# ── Helpers ──────────────────────────────────────────────────────────────────

def run_pipeline_with_events(cfg: dict, cli_input: str | None = None):
    """
    Generator that yields SSE events as the pipeline executes.
    Each event is a dict with 'type' and relevant fields.
    """
    source_text = freestyle.resolve_source(cfg.get("source", {}), cli_input)
    yield {"type": "source", "chars": len(source_text)}

    lenses = cfg.get("lens", [])
    sinks = cfg.get("sink", [])
    outputs = {"source": source_text}

    sorted_lenses = freestyle.topological_sort(lenses)
    skipped = set()

    for lens in sorted_lenses:
        lid = lens["id"]
        model = lens.get("model", freestyle.DEFAULT_MODEL)
        system = lens.get("system", "You are a helpful assistant.")
        temperature = lens.get("temperature", freestyle.DEFAULT_TEMP)
        is_bcc = lens.get("bcc", False)
        is_gate = lens.get("gate", False)
        merge_strat = lens.get("merge_strategy", "concat")
        frm = lens.get("from", "source")

        if lid in skipped:
            yield {"type": "skipped", "id": lid}
            continue

        upstream_ids = [frm] if isinstance(frm, str) else frm
        missing = [u for u in upstream_ids if u not in outputs]
        if missing:
            yield {"type": "error", "id": lid, "text": f"upstream not ready: {missing}"}
            continue

        if isinstance(frm, str):
            user_text = outputs[frm]
        else:
            user_text = freestyle.merge_inputs(
                {u: outputs[u] for u in frm},
                strategy=merge_strat,
            )

        yield {"type": "lens_start", "id": lid, "model": model}

        try:
            result = freestyle.call_model(model, system, user_text, temperature)
        except RuntimeError as e:
            outputs[lid] = f"[ERROR: {e}]"
            yield {"type": "error", "id": lid, "text": str(e)}
            continue

        outputs[lid] = result
        yield {"type": "lens_done", "id": lid, "text": result}

        if is_gate:
            winning_id = freestyle.resolve_gate(lens, result, outputs)
            routes = lens.get("routes", {})
            all_targets = set(routes.values())
            for loser in all_targets:
                if loser != winning_id:
                    skipped.add(loser)

    # Sinks
    non_bcc_sink_ids = {l.get("sink_id") for l in lenses if l.get("bcc")}
    for sink in sinks:
        if sink.get("id") in non_bcc_sink_ids:
            continue
        from_id = sink.get("from")
        if from_id in outputs:
            yield {"type": "sink", "id": sink.get("id", ""), "text": outputs[from_id]}

    yield {"type": "done"}


# ── Routes ───────────────────────────────────────────────────────────────────

async def health(request: Request):
    ollama_ok = False
    try:
        r = httpx.get(f"{freestyle.OLLAMA_BASE}/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except Exception:
        pass
    return JSONResponse({"ok": True, "ollama": ollama_ok})


async def models(request: Request):
    try:
        r = httpx.get(f"{freestyle.OLLAMA_BASE}/api/tags", timeout=5)
        r.raise_for_status()
        data = r.json()
        names = [m["name"] for m in data.get("models", [])]
        return JSONResponse({"models": names})
    except Exception as e:
        return JSONResponse({"models": [], "error": str(e)}, status_code=502)


async def dry_run(request: Request):
    body = await request.json()
    toml_str = body.get("toml", "")
    try:
        cfg = tomllib.loads(toml_str)
    except Exception as e:
        return JSONResponse({"error": f"Invalid TOML: {e}"}, status_code=400)

    lenses = cfg.get("lens", [])
    try:
        ordered = freestyle.topological_sort(lenses)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    graph = []
    for lens in ordered:
        graph.append({
            "id": lens["id"],
            "from": lens.get("from", "source"),
            "model": lens.get("model", freestyle.DEFAULT_MODEL),
            "flags": [f for f in ["bcc", "gate", "spawn"] if lens.get(f)],
        })
    return JSONResponse({"graph": graph})


async def run_pipeline(request: Request):
    body = await request.json()
    toml_str = body.get("toml", "")
    input_text = body.get("input")

    try:
        cfg = tomllib.loads(toml_str)
    except Exception as e:
        return JSONResponse({"error": f"Invalid TOML: {e}"}, status_code=400)

    async def event_stream():
        loop = asyncio.get_event_loop()
        # Run the blocking pipeline in a thread
        events = await loop.run_in_executor(
            None,
            lambda: list(run_pipeline_with_events(cfg, cli_input=input_text)),
        )
        for event in events:
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


routes = [
    Route("/api/health", health, methods=["GET"]),
    Route("/api/models", models, methods=["GET"]),
    Route("/api/dry-run", dry_run, methods=["POST"]),
    Route("/api/run", run_pipeline, methods=["POST"]),
]

app = Starlette(routes=routes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8765"))
    print(f"  playdesk server on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
