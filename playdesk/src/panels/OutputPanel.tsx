import Markdown from 'react-markdown';
import { usePlaydeskStore } from '../store/pipeline-store';

export function OutputPanel() {
  const lensOutputs = usePlaydeskStore((s) => s.lensOutputs);
  const runStatus = usePlaydeskStore((s) => s.runStatus);

  const entries = Object.entries(lensOutputs);

  return (
    <div className="output-panel">
      <div className="output-panel-header">
        <span>Output</span>
        {runStatus === 'running' && <span className="spinner" />}
        <span className={`run-badge ${runStatus}`}>{runStatus}</span>
      </div>
      <div className="output-panel-body">
        {entries.length === 0 ? (
          <p className="output-empty">Run a pipeline to see output here.</p>
        ) : (
          entries.map(([id, output]) => (
            <div key={id} className={`output-entry ${output.status}`}>
              <div className="output-entry-header">
                <span className="output-lens-id">
                  {output.status === 'streaming' && <span className="spinner small" />}
                  {id}
                </span>
                <span className={`output-status ${output.status}`}>
                  {output.status}
                </span>
              </div>
              <div className="output-text">
                {output.text ? (
                  <Markdown>{output.text}</Markdown>
                ) : output.status === 'streaming' ? (
                  <span className="output-waiting">Thinking...</span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
