import { Handle, Position, type NodeProps } from '@xyflow/react';
import { usePlaydeskStore } from '../store/pipeline-store';
import { NODE_COLORS } from '../lib/constants';
import type { SinkNodeData } from '../lib/toml-graph';

export function SinkNode({ id, data }: NodeProps) {
  const d = data as SinkNodeData;
  const updateNodeData = usePlaydeskStore((s) => s.updateNodeData);
  const syncCanvasToToml = usePlaydeskStore((s) => s.syncCanvasToToml);

  const update = (patch: Record<string, unknown>) => {
    updateNodeData(id, patch);
    setTimeout(syncCanvasToToml, 200);
  };

  return (
    <div className="playdesk-node" style={{ borderColor: NODE_COLORS.sink }}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header" style={{ background: NODE_COLORS.sink }}>
        <span className="node-icon">💾</span> {d.sinkId}
      </div>
      <div className="node-body">
        <label>
          type
          <select
            value={d.sinkType}
            onChange={(e) => update({ sinkType: e.target.value })}
          >
            <option value="stdout">stdout</option>
            <option value="file">file</option>
            <option value="http">http</option>
          </select>
        </label>
        {d.sinkType === 'file' && (
          <label>
            path
            <input
              value={d.path || ''}
              onChange={(e) => update({ path: e.target.value })}
            />
          </label>
        )}
        {d.sinkType === 'http' && (
          <>
            <label>
              url
              <input
                value={d.url || ''}
                onChange={(e) => update({ url: e.target.value })}
              />
            </label>
            <label>
              method
              <select
                value={d.method || 'POST'}
                onChange={(e) => update({ method: e.target.value })}
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  );
}
