import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import type {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
} from '@xyflow/react';
import type { PipelineMeta } from '../types/pipeline';
import { tomlToFlow, flowToToml } from '../lib/toml-graph';
import { DEFAULT_MODEL } from '../lib/constants';

interface LensOutput {
  text: string;
  status: 'pending' | 'streaming' | 'done' | 'error';
}

interface PlaydeskState {
  // Pipeline data
  meta: PipelineMeta;
  nodes: Node[];
  edges: Edge[];
  tomlString: string;

  // Sync
  syncSource: 'canvas' | 'toml' | null;

  // UI state
  tomlPanelOpen: boolean;
  outputPanelOpen: boolean;
  globalModel: string;
  availableModels: string[];

  // Run state
  runStatus: 'idle' | 'running' | 'done' | 'error';
  lensOutputs: Record<string, LensOutput>;

  // Actions
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  setToml: (toml: string) => void;
  syncCanvasToToml: () => void;
  syncTomlToCanvas: () => void;
  loadFromToml: (toml: string) => void;
  toggleTomlPanel: () => void;
  toggleOutputPanel: () => void;
  setGlobalModel: (model: string) => void;
  setAvailableModels: (models: string[]) => void;
  setRunStatus: (status: PlaydeskState['runStatus']) => void;
  setLensOutput: (lensId: string, output: LensOutput) => void;
  clearOutputs: () => void;
}

const INITIAL_TOML = `[pipeline]
name = "new_pipeline"

[source]
type = "text"
text = "Hello, world!"

[[lens]]
id = "step1"
model = "${DEFAULT_MODEL}"
system = "You are a helpful assistant."
from = "source"
temperature = 0.7

[[sink]]
id = "out"
type = "stdout"
from = "step1"
`;

export const usePlaydeskStore = create<PlaydeskState>((set, get) => {
  const initial = tomlToFlow(INITIAL_TOML);

  return {
    meta: initial.meta,
    nodes: initial.nodes,
    edges: initial.edges,
    tomlString: INITIAL_TOML,

    syncSource: null,
    tomlPanelOpen: false,
    outputPanelOpen: false,
    globalModel: DEFAULT_MODEL,
    availableModels: [],

    runStatus: 'idle',
    lensOutputs: {},

    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),

    onNodesChange: (changes) => {
      set((state) => ({
        nodes: applyNodeChanges(changes, state.nodes),
      }));
    },

    onEdgesChange: (changes) => {
      set((state) => ({
        edges: applyEdgeChanges(changes, state.edges),
      }));
    },

    onConnect: (connection) => {
      set((state) => ({
        edges: addEdge(connection, state.edges),
        syncSource: 'canvas',
      }));
      // Sync after connecting
      setTimeout(() => get().syncCanvasToToml(), 100);
    },

    updateNodeData: (nodeId, data) => {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
        ),
        syncSource: 'canvas',
      }));
    },

    setToml: (toml) => {
      set({ tomlString: toml, syncSource: 'toml' });
    },

    syncCanvasToToml: () => {
      const { nodes, edges, meta, syncSource } = get();
      if (syncSource === 'toml') {
        set({ syncSource: null });
        return;
      }
      try {
        const toml = flowToToml(nodes, edges, meta);
        set({ tomlString: toml, syncSource: null });
      } catch {
        // Invalid state, skip sync
        set({ syncSource: null });
      }
    },

    syncTomlToCanvas: () => {
      const { tomlString, syncSource } = get();
      if (syncSource === 'canvas') {
        set({ syncSource: null });
        return;
      }
      try {
        const { nodes, edges, meta } = tomlToFlow(tomlString);
        set({ nodes, edges, meta, syncSource: null });
      } catch {
        // Invalid TOML, skip sync
        set({ syncSource: null });
      }
    },

    loadFromToml: (toml) => {
      try {
        const { nodes, edges, meta } = tomlToFlow(toml);
        set({
          nodes,
          edges,
          meta,
          tomlString: toml,
          syncSource: null,
        });
      } catch (e) {
        console.error('Failed to load TOML:', e);
      }
    },

    toggleTomlPanel: () => set((s) => ({ tomlPanelOpen: !s.tomlPanelOpen })),
    toggleOutputPanel: () => set((s) => ({ outputPanelOpen: !s.outputPanelOpen })),
    setGlobalModel: (model) => set({ globalModel: model }),
    setAvailableModels: (models) => set({ availableModels: models }),
    setRunStatus: (status) => set({ runStatus: status }),
    setLensOutput: (lensId, output) =>
      set((s) => ({
        lensOutputs: { ...s.lensOutputs, [lensId]: output },
      })),
    clearOutputs: () => set({ lensOutputs: {}, runStatus: 'idle' }),
  };
});
