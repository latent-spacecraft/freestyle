import type { Node, Edge } from '@xyflow/react';
import { parse as tomlParse, stringify as tomlStringify } from 'smol-toml';
import dagre from '@dagrejs/dagre';
import type { Pipeline, Lens, Sink } from '../types/pipeline';
import { DEFAULT_MODEL, DEFAULT_TEMPERATURE, DEFAULT_SYSTEM } from './constants';

// ── Node data types ─────────────────────────────────────────────────────────

export interface SourceNodeData {
  label: string;
  sourceType: string;
  text?: string;
  path?: string;
  url?: string;
  [key: string]: unknown;
}

export interface LensNodeData {
  label: string;
  lensId: string;
  model: string;
  system: string;
  temperature: number;
  mergeStrategy: string;
  bcc: boolean;
  sinkId?: string;
  gate: boolean;
  routes?: Record<string, string>;
  emit?: string;
  spawn: boolean;
  [key: string]: unknown;
}

export interface SinkNodeData {
  label: string;
  sinkId: string;
  sinkType: string;
  path?: string;
  url?: string;
  method?: string;
  [key: string]: unknown;
}

// ── TOML → ReactFlow ────────────────────────────────────────────────────────

export function tomlToFlow(tomlString: string): {
  nodes: Node[];
  edges: Edge[];
  meta: Pipeline['pipeline'];
} {
  const cfg = tomlParse(tomlString) as unknown as Pipeline;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const meta = cfg.pipeline || { name: 'unnamed' };
  const source = cfg.source || { type: 'stdin' };
  const lenses: Lens[] = cfg.lens || [];
  const sinks: Sink[] = cfg.sink || [];

  // Source node
  nodes.push({
    id: 'source',
    type: 'source',
    position: { x: 0, y: 0 },
    data: {
      label: 'source',
      sourceType: source.type || 'stdin',
      text: source.text,
      path: source.path,
      url: source.url,
    } satisfies SourceNodeData,
  });

  // Lens nodes
  for (const lens of lenses) {
    const nodeType = lens.gate ? 'gate' : lens.bcc ? 'bcc' : 'lens';
    nodes.push({
      id: lens.id,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: {
        label: lens.id,
        lensId: lens.id,
        model: lens.model || DEFAULT_MODEL,
        system: lens.system || DEFAULT_SYSTEM,
        temperature: lens.temperature ?? DEFAULT_TEMPERATURE,
        mergeStrategy: lens.merge_strategy || 'concat',
        bcc: lens.bcc || false,
        sinkId: lens.sink_id,
        gate: lens.gate || false,
        routes: lens.routes,
        emit: lens.emit,
        spawn: lens.spawn || false,
      } satisfies LensNodeData,
    });

    // Edges from upstream
    const froms = Array.isArray(lens.from) ? lens.from : [lens.from || 'source'];
    for (const f of froms) {
      edges.push({
        id: `${f}->${lens.id}`,
        source: f,
        target: lens.id,
        animated: lens.bcc || false,
      });
    }
  }

  // Sink nodes
  for (const sink of sinks) {
    nodes.push({
      id: `sink-${sink.id}`,
      type: 'sink',
      position: { x: 0, y: 0 },
      data: {
        label: sink.id,
        sinkId: sink.id,
        sinkType: sink.type || 'stdout',
        path: sink.path,
        url: sink.url,
        method: sink.method,
      } satisfies SinkNodeData,
    });

    if (sink.from) {
      edges.push({
        id: `${sink.from}->sink-${sink.id}`,
        source: sink.from,
        target: `sink-${sink.id}`,
      });
    }
  }

  // Auto-layout
  const laid = autoLayout(nodes, edges);
  return { nodes: laid, edges, meta };
}

// ── ReactFlow → TOML ────────────────────────────────────────────────────────

export function flowToToml(
  nodes: Node[],
  edges: Edge[],
  meta: Pipeline['pipeline']
): string {
  const cfg: Record<string, unknown> = {};

  // Pipeline metadata
  cfg.pipeline = { ...meta };

  // Source
  const sourceNode = nodes.find((n) => n.id === 'source');
  if (sourceNode) {
    const d = sourceNode.data as SourceNodeData;
    const source: Record<string, unknown> = { type: d.sourceType };
    if (d.sourceType === 'text' && d.text) source.text = d.text;
    if (d.sourceType === 'file' && d.path) source.path = d.path;
    if (d.sourceType === 'http' && d.url) source.url = d.url;
    cfg.source = source;
  }

  // Lenses
  const lensNodes = nodes.filter(
    (n) => n.type === 'lens' || n.type === 'gate' || n.type === 'bcc'
  );
  if (lensNodes.length > 0) {
    cfg.lens = lensNodes.map((n) => {
      const d = n.data as LensNodeData;
      const incoming = edges.filter((e) => e.target === n.id).map((e) => e.source);
      const from = incoming.length === 1 ? incoming[0] : incoming.length > 1 ? incoming : 'source';

      const lens: Record<string, unknown> = {
        id: d.lensId,
        model: d.model,
        system: d.system,
        from,
        temperature: d.temperature,
      };

      if (Array.isArray(from) && from.length > 1 && d.mergeStrategy !== 'concat') {
        lens.merge_strategy = d.mergeStrategy;
      }
      if (d.bcc) {
        lens.bcc = true;
        if (d.sinkId) lens.sink_id = d.sinkId;
      }
      if (d.gate) {
        lens.gate = true;
        if (d.routes) lens.routes = d.routes;
      }
      if (d.emit) lens.emit = d.emit;
      if (d.spawn) lens.spawn = true;

      return lens;
    });
  }

  // Sinks
  const sinkNodes = nodes.filter((n) => n.type === 'sink');
  if (sinkNodes.length > 0) {
    cfg.sink = sinkNodes.map((n) => {
      const d = n.data as SinkNodeData;
      const incoming = edges.filter((e) => e.target === n.id);
      const from = incoming.length > 0 ? incoming[0].source : '';

      const sink: Record<string, unknown> = {
        id: d.sinkId,
        type: d.sinkType,
        from,
      };
      if (d.sinkType === 'file' && d.path) sink.path = d.path;
      if (d.sinkType === 'http') {
        if (d.url) sink.url = d.url;
        if (d.method) sink.method = d.method;
      }
      return sink;
    });
  }

  return tomlStringify(cfg as Record<string, unknown>);
}

// ── Auto-layout (dagre) ─────────────────────────────────────────────────────

function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 260;
  const nodeHeight = 180;

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2,
      },
    };
  });
}
