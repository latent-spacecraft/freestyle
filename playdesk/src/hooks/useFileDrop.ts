import { useCallback, useEffect } from 'react';
import { usePlaydeskStore } from '../store/pipeline-store';

export function useFileDrop() {
  const loadFromToml = usePlaydeskStore((s) => s.loadFromToml);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file || !file.name.endsWith('.toml')) return;

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          loadFromToml(reader.result);
        }
      };
      reader.readAsText(file);
    },
    [loadFromToml]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragover', handleDragOver);
    return () => {
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragover', handleDragOver);
    };
  }, [handleDrop, handleDragOver]);
}
