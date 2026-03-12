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

def resolve_inline_attachments(
    paths: list[str],
    inline: dict[str, dict] | None,
    pipeline_dir: str,
) -> list[dict]:
    """
    Resolve attachment paths: use inline data from playdesk if available,
    otherwise load from disk.
    """
    result = []
    for p in paths:
        if inline and p in inline:
            att = inline[p]
            result.append({
                "path": p,
                "mime": att["mime"],
                "data_b64": att["data_b64"],
            })
        else:
            result.extend(freestyle.load_attachments([p], pipeline_dir))
    return result


def run_pipeline_with_events(
    cfg: dict,
    cli_input: str | None = None,
    inline_attachments: dict[str, dict] | None = None,
):
    """
    Generator that yields SSE events as the pipeline executes.
    Each event is a dict with 'type' and relevant fields.
    """
    source_cfg = cfg.get("source", {})
    source_text = freestyle.resolve_source(source_cfg, cli_input)
    yield {"type": "source", "chars": len(source_text)}

    # Load source attachments
    pipeline_dir = cfg.get("_base_dir", ".")
    source_att_paths = source_cfg.get("attachments", [])
    source_attachments = resolve_inline_attachments(
        source_att_paths, inline_attachments, pipeline_dir
    ) if source_att_paths else []

    lenses = cfg.get("lens", [])
    sinks = cfg.get("sink", [])
    outputs = {"source": source_text}
    att_bank: dict[str, list[dict]] = {"source": source_attachments}

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
        forward_att = lens.get("forward_attachments", True)
        lens_att_paths = lens.get("attachments", [])

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

        # Collect attachments
        combined_att: list[dict] = []
        if forward_att:
            for uid in upstream_ids:
                combined_att.extend(att_bank.get(uid, []))
        if lens_att_paths:
            combined_att.extend(resolve_inline_attachments(
                lens_att_paths, inline_attachments, pipeline_dir
            ))
        seen: set[str] = set()
        deduped_att = [a for a in combined_att if a["path"] not in seen and not seen.add(a["path"])]  # type: ignore
        att_bank[lid] = deduped_att

        att_count = len(deduped_att)
        yield {"type": "lens_start", "id": lid, "model": model, "attachments": att_count}

        try:
            result = freestyle.call_model(model, system, user_text, temperature, attachments=deduped_att or None)
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
    inline_att = body.get("inline_attachments")  # {name: {mime, data_b64}}

    try:
        cfg = tomllib.loads(toml_str)
    except Exception as e:
        return JSONResponse({"error": f"Invalid TOML: {e}"}, status_code=400)

    async def event_stream():
        loop = asyncio.get_event_loop()
        # Run the blocking pipeline in a thread
        events = await loop.run_in_executor(
            None,
            lambda: list(run_pipeline_with_events(
                cfg, cli_input=input_text, inline_attachments=inline_att
            )),
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
