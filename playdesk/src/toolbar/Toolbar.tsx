import { usePlaydeskStore } from '../store/pipeline-store';
import { useFreestyleApi } from '../hooks/useFreestyleApi';

export function Toolbar() {
  const tomlString = usePlaydeskStore((s) => s.tomlString);
  const toggleTomlPanel = usePlaydeskStore((s) => s.toggleTomlPanel);
  const tomlPanelOpen = usePlaydeskStore((s) => s.tomlPanelOpen);
  const toggleOutputPanel = usePlaydeskStore((s) => s.toggleOutputPanel);
  const runStatus = usePlaydeskStore((s) => s.runStatus);
  const loadFromToml = usePlaydeskStore((s) => s.loadFromToml);
  const globalModel = usePlaydeskStore((s) => s.globalModel);
  const setGlobalModel = usePlaydeskStore((s) => s.setGlobalModel);
  const availableModels = usePlaydeskStore((s) => s.availableModels);

  const { run, dryRun } = useFreestyleApi();

  const handleCopy = () => {
    navigator.clipboard.writeText(tomlString);
  };

  const handleSave = () => {
    const blob = new Blob([tomlString], { type: 'application/toml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pipeline.toml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpen = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.toml';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          loadFromToml(reader.result);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="toolbar">
      <button
        className="toolbar-btn primary"
        onClick={run}
        disabled={runStatus === 'running'}
      >
        ▶ Run
      </button>
      <button className="toolbar-btn" onClick={dryRun}>
        ⏸ Dry Run
      </button>
      <div className="toolbar-sep" />
      <button className="toolbar-btn" onClick={handleCopy}>
        📋 Copy TOML
      </button>
      <button className="toolbar-btn" onClick={handleSave}>
        💾 Save
      </button>
      <button className="toolbar-btn" onClick={handleOpen}>
        📂 Open
      </button>
      <div className="toolbar-sep" />
      <button
        className={`toolbar-btn ${tomlPanelOpen ? 'active' : ''}`}
        onClick={toggleTomlPanel}
      >
        { tomlPanelOpen ? '✕ TOML' : '{ } TOML' }
      </button>
      <button className="toolbar-btn" onClick={toggleOutputPanel}>
        ↑ Output
      </button>
      <div className="toolbar-spacer" />
      <label className="toolbar-model">
        🔀
        <select
          value={globalModel}
          onChange={(e) => setGlobalModel(e.target.value)}
        >
          {availableModels.length > 0 ? (
            availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))
          ) : (
            <option value={globalModel}>{globalModel}</option>
          )}
        </select>
      </label>
    </div>
  );
}
