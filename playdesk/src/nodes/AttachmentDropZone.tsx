import { useCallback, useRef, useState } from 'react';

export interface AttachmentFile {
  name: string;
  mime: string;
  data_b64: string;
  size: number;
}

interface Props {
  files: AttachmentFile[];
  onChange: (files: AttachmentFile[]) => void;
}

function readFileAsAttachment(file: File): Promise<AttachmentFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:mime;base64," prefix
      const b64 = result.split(',')[1] || '';
      resolve({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        data_b64: b64,
        size: file.size,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function mimeIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('audio/')) return '🔊';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.includes('pdf')) return '📄';
  return '📎';
}

export function AttachmentDropZone({ files, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (fileList: FileList) => {
      const newFiles: AttachmentFile[] = [];
      for (const f of Array.from(fileList)) {
        // skip duplicates by name
        if (!files.some((existing) => existing.name === f.name)) {
          newFiles.push(await readFileAsAttachment(f));
        }
      }
      if (newFiles.length > 0) {
        onChange([...files, ...newFiles]);
      }
    },
    [files, onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = ''; // reset so same file can be re-added
      }
    },
    [addFiles]
  );

  const removeFile = useCallback(
    (name: string) => {
      onChange(files.filter((f) => f.name !== name));
    },
    [files, onChange]
  );

  return (
    <div className="attachment-zone">
      <div
        className={`attachment-droparea ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={handleDrop}
        onClick={handleBrowse}
      >
        <span className="droparea-text">
          {dragOver ? 'Drop here' : 'Drop files or click to browse'}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </div>
      {files.length > 0 && (
        <div className="attachment-list">
          {files.map((f) => (
            <div key={f.name} className="attachment-item">
              <span className="attachment-icon">{mimeIcon(f.mime)}</span>
              <span className="attachment-name">{f.name}</span>
              <span className="attachment-size">{formatSize(f.size)}</span>
              <button
                className="attachment-remove"
                onClick={() => removeFile(f.name)}
                title="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
