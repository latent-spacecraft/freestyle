export interface PipelineMeta {
  name: string;
  version?: string;
  description?: string;
  author?: string;
}

export interface Source {
  type: 'stdin' | 'text' | 'file' | 'http';
  text?: string;
  path?: string;
  url?: string;
}

export interface Lens {
  id: string;
  model?: string;
  system?: string;
  from?: string | string[];
  temperature?: number;
  merge_strategy?: 'concat' | 'interleave' | 'xml_tagged';
  bcc?: boolean;
  sink_id?: string;
  gate?: boolean;
  routes?: Record<string, string>;
  emit?: 'toml';
  spawn?: boolean;
}

export interface Sink {
  id: string;
  type: 'stdout' | 'file' | 'http';
  from: string;
  path?: string;
  url?: string;
  method?: string;
}

export interface Pipeline {
  pipeline: PipelineMeta;
  source: Source;
  lens: Lens[];
  sink: Sink[];
}
