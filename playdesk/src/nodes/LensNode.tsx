import { Handle, Position, type NodeProps } from '@xyflow/react';
import { usePlaydeskStore } from '../store/pipeline-store';
import { NODE_COLORS, MERGE_STRATEGIES } from '../lib/constants';
import type { LensNodeData } from '../lib/toml-graph';
import { AttachmentDropZone } from './AttachmentDropZone';
import type { AttachmentFile } from './AttachmentDropZone';

export function LensNode({ id, data }: NodeProps) {
  const d = data as LensNodeData;
  const updateNodeData = usePlaydeskStore((s) => s.updateNodeData);
  const syncCanvasToToml = usePlaydeskStore((s) => s.syncCanvasToToml);
  const availableModels = usePlaydeskStore((s) => s.availableModels);

  const color = d.bcc ? NODE_COLORS.bcc : d.gate ? NODE_COLORS.gate : NODE_COLORS.lens;
  const icon = d.bcc ? '👻' : d.gate ? '🔀' : '🔮';

  const update = (patch: Record<string, unknown>) => {
    updateNodeData(id, patch);
    setTimeout(syncCanvasToToml, 200);
  };

  const handleAttachmentChange = (files: AttachmentFile[]) => {
    update({
      attachmentFiles: files,
      attachments: files.map((f) => f.name),
    });
  };

  return (
    <div className="playdesk-node" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header" style={{ background: color }}>
        <span className="node-icon">{icon}</span> {d.lensId}
      </div>
      <div className="node-body">
        <label>
          model
          <select
            value={d.model}
            onChange={(e) => update({ model: e.target.value })}
          >
            {availableModels.length > 0 ? (
              availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))
            ) : (
              <option value={d.model}>{d.model}</option>
            )}
          </select>
        </label>
        <label>
          system
          <textarea
            value={d.system}
            onChange={(e) => update({ system: e.target.value })}
            rows={3}
            className="system-prompt"
          />
        </label>
        <label>
          temp
          <div className="slider-row">
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={d.temperature}
              onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
            />
            <span className="slider-value">{d.temperature.toFixed(1)}</span>
          </div>
        </label>
        <label>
          merge
          <select
            value={d.mergeStrategy}
            onChange={(e) => update({ mergeStrategy: e.target.value })}
          >
            {MERGE_STRATEGIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>attachments</label>
        <AttachmentDropZone
          files={d.attachmentFiles || []}
          onChange={handleAttachmentChange}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={d.forwardAttachments}
            onChange={(e) => update({ forwardAttachments: e.target.checked })}
          />
          forward upstream attachments
        </label>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
