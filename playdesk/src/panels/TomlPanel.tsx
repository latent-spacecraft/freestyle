import { useEffect, useRef, useCallback } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { basicSetup } from 'codemirror';
import { usePlaydeskStore } from '../store/pipeline-store';

export function TomlPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const tomlString = usePlaydeskStore((s) => s.tomlString);
  const setToml = usePlaydeskStore((s) => s.setToml);
  const syncTomlToCanvas = usePlaydeskStore((s) => s.syncTomlToCanvas);
  const syncSource = usePlaydeskStore((s) => s.syncSource);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = useCallback(
    (value: string) => {
      setToml(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        syncTomlToCanvas();
      }, 500);
    },
    [setToml, syncTomlToCanvas]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: tomlString,
      extensions: [
        basicSetup,
        json(),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-content': { fontFamily: 'monospace' },
          '.cm-scroller': { overflow: 'auto' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            handleChange(update.state.doc.toString());
          }
        }),
        keymap.of([]),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create editor once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update editor when TOML changes from canvas sync
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (syncSource === 'toml') return; // Don't update if we caused the change

    const current = view.state.doc.toString();
    if (current !== tomlString) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: tomlString },
      });
    }
  }, [tomlString, syncSource]);

  return (
    <div className="toml-panel">
      <div className="toml-panel-header">
        <span>TOML</span>
      </div>
      <div className="toml-panel-editor" ref={containerRef} />
    </div>
  );
}
