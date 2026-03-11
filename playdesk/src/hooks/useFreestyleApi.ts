import { useCallback } from 'react';
import { usePlaydeskStore } from '../store/pipeline-store';
import { SERVER_URL } from '../lib/constants';

export function useFreestyleApi() {
  const tomlString = usePlaydeskStore((s) => s.tomlString);
  const setRunStatus = usePlaydeskStore((s) => s.setRunStatus);
  const setLensOutput = usePlaydeskStore((s) => s.setLensOutput);
  const clearOutputs = usePlaydeskStore((s) => s.clearOutputs);
  const setAvailableModels = usePlaydeskStore((s) => s.setAvailableModels);
  const toggleOutputPanel = usePlaydeskStore((s) => s.toggleOutputPanel);
  const outputPanelOpen = usePlaydeskStore((s) => s.outputPanelOpen);

  const run = useCallback(async () => {
    clearOutputs();
    setRunStatus('running');
    if (!outputPanelOpen) toggleOutputPanel();

    try {
      const res = await fetch(`${SERVER_URL}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml: tomlString }),
      });

      if (!res.ok) {
        const err = await res.text();
        setRunStatus('error');
        setLensOutput('_error', { text: err, status: 'error' });
        return;
      }

      // SSE streaming
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        setRunStatus('error');
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'lens_start') {
                setLensOutput(event.id, { text: '', status: 'streaming' });
              } else if (event.type === 'lens_done') {
                setLensOutput(event.id, { text: event.text, status: 'done' });
              } else if (event.type === 'error') {
                setLensOutput(event.id || '_error', {
                  text: event.text,
                  status: 'error',
                });
              } else if (event.type === 'done') {
                setRunStatus('done');
              }
            } catch {
              // skip malformed SSE
            }
          }
        }
      }

      setRunStatus('done');
    } catch (e) {
      setRunStatus('error');
      setLensOutput('_error', {
        text: String(e),
        status: 'error',
      });
    }
  }, [tomlString, clearOutputs, setRunStatus, setLensOutput, toggleOutputPanel, outputPanelOpen]);

  const dryRun = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml: tomlString }),
      });
      return await res.json();
    } catch (e) {
      console.error('Dry run failed:', e);
      return null;
    }
  }, [tomlString]);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/models`);
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models || []);
      }
    } catch {
      // Server not running, use empty list
    }
  }, [setAvailableModels]);

  return { run, dryRun, fetchModels };
}
