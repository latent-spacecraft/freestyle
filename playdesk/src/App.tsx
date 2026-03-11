import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type SnapGrid,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { usePlaydeskStore } from './store/pipeline-store';
import { useFreestyleApi } from './hooks/useFreestyleApi';
import { useFileDrop } from './hooks/useFileDrop';
import { SourceNode } from './nodes/SourceNode';
import { LensNode } from './nodes/LensNode';
import { SinkNode } from './nodes/SinkNode';
import { TomlPanel } from './panels/TomlPanel';
import { OutputPanel } from './panels/OutputPanel';
import { Toolbar } from './toolbar/Toolbar';
import './App.css';

const nodeTypes: NodeTypes = {
  source: SourceNode,
  lens: LensNode,
  gate: LensNode,
  bcc: LensNode,
  sink: SinkNode,
};

function App() {
  const nodes = usePlaydeskStore((s) => s.nodes);
  const edges = usePlaydeskStore((s) => s.edges);
  const onNodesChange = usePlaydeskStore((s) => s.onNodesChange);
  const onEdgesChange = usePlaydeskStore((s) => s.onEdgesChange);
  const onConnect = usePlaydeskStore((s) => s.onConnect);
  const tomlPanelOpen = usePlaydeskStore((s) => s.tomlPanelOpen);
  const outputPanelOpen = usePlaydeskStore((s) => s.outputPanelOpen);
  const meta = usePlaydeskStore((s) => s.meta);

  const snapGrid = useMemo<SnapGrid>(() => [20, 20], []);
  const syncCanvasToToml = usePlaydeskStore((s) => s.syncCanvasToToml);

  const onNodeDragStop = useCallback(() => {
    syncCanvasToToml();
  }, [syncCanvasToToml]);

  const { fetchModels } = useFreestyleApi();
  useFileDrop();

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const minimapColors = useMemo(
    () => ({
      source: '#5c85a6',
      lens: '#c76d61',
      gate: '#e5b25d',
      bcc: '#f4f1ea',
      sink: '#2b2d42',
    }),
    []
  );

  return (
    <div className="playdesk">
      <div className="playdesk-header">
        <img src="/freestyle-logo.png" alt="freestyle" className="playdesk-logo" />
        <span className="playdesk-title">playdesk</span>
        <span className="playdesk-pipeline-name">{meta.name}</span>
        {meta.description && (
          <span className="playdesk-pipeline-desc">{meta.description}</span>
        )}
      </div>

      <div className="playdesk-main">
        <div className="playdesk-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            snapToGrid
            snapGrid={snapGrid}
            onNodeDragStop={onNodeDragStop}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={20} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(node) =>
                minimapColors[node.type as keyof typeof minimapColors] || '#666'
              }
              pannable
              zoomable
            />
          </ReactFlow>
        </div>

        {tomlPanelOpen && <TomlPanel />}
      </div>

      {outputPanelOpen && <OutputPanel />}

      <Toolbar />
    </div>
  );
}

export default App;
