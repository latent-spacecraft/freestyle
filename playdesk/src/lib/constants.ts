export const NODE_COLORS = {
  source: '#3b82f6',   // blue
  lens:   '#a855f7',   // purple
  sink:   '#22c55e',   // green
  gate:   '#eab308',   // yellow
  bcc:    '#374151',   // dark gray
} as const;

export const DEFAULT_MODEL = 'qwen3:0.6b';
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_SYSTEM = 'You are a helpful assistant.';

export const MERGE_STRATEGIES = ['concat', 'interleave', 'xml_tagged'] as const;

export const SERVER_URL = 'http://localhost:8765';
