import { Handle, Position, type NodeProps } from '@xyflow/react';
import { usePlaydeskStore } from '../store/pipeline-store';
import { NODE_COLORS } from '../lib/constants';
import type { SourceNodeData } from '../lib/toml-graph';
import { AttachmentDropZone } from './AttachmentDropZone';
import type { AttachmentFile } from './AttachmentDropZone';

export function SourceNode({ id, data }: NodeProps) {
  const d = data as SourceNodeData;
  const updateNodeData = usePlaydeskStore((s) => s.updateNodeData);
  const syncCanvasToToml = usePlaydeskStore((s) => s.syncCanvasToToml);

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
    <div className="playdesk-node" style={{ borderColor: NODE_COLORS.source }}>
      <div className="node-header" style={{ background: NODE_COLORS.source }}>
        <span className="node-icon">📥</span> source
      </div>
      <div className="node-body">
        <label>
          type
          <select
            value={d.sourceType}
            onChange={(e) => update({ sourceType: e.target.value })}
          >
            <option value="text">text</option>
            <option value="file">file</option>
            <option value="http">http</option>
            <option value="stdin">stdin</option>
          </select>
        </label>
        {d.sourceType === 'text' && (
          <label>
            text
            <textarea
              value={d.text || ''}
              onChange={(e) => update({ text: e.target.value })}
              rows={3}
            />
          </label>
        )}
        {d.sourceType === 'file' && (
          <label>
            path
            <input
              value={d.path || ''}
              onChange={(e) => update({ path: e.target.value })}
            />
          </label>
        )}
        {d.sourceType === 'http' && (
          <label>
            url
            <input
              value={d.url || ''}
              onChange={(e) => update({ url: e.target.value })}
            />
          </label>
        )}
        <label>attachments</label>
        <AttachmentDropZone
          files={d.attachmentFiles || []}
          onChange={handleAttachmentChange}
        />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
