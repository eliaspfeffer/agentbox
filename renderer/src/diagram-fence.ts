// WHICH CODE BLOCKS ARE CHARTS (tests/a-flowchart-in-a-message-is-drawn-as-a-chart).
//
// A block tagged `mermaid` is one because the worker said so. An untagged block
// is one only when its first line is a Mermaid chart header and nothing else,
// so "graph of the results" and "flowcharts are broken" stay words. A block
// tagged as any other language is never one, whatever it contains.

const HEADER = new RegExp(
  '^(?:' + [
    '(?:flowchart|graph)(?:\\s+(?:TB|TD|BT|RL|LR))?\\s*;?',
    'sequenceDiagram', 'classDiagram(?:-v2)?', 'stateDiagram(?:-v2)?',
    'erDiagram', 'journey', 'gantt', 'pie(?:\\s+.*)?', 'gitGraph(?:\\s+.*)?',
    'mindmap', 'timeline', 'quadrantChart', 'requirementDiagram',
    'C4(?:Context|Container|Component|Dynamic|Deployment)',
    '(?:xychart|sankey|block|packet|architecture|kanban|radar)(?:-beta)?',
  ].join('|') + ')$',
);

/** The chart's source if this fenced block should be drawn as a chart, else null. */
export function diagramSource(lang: string | undefined, text: string): string | null {
  const source = text.replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (!source.trim()) return null;
  const tag = lang?.toLowerCase();
  if (tag === 'mermaid') return source;
  if (tag) return null;
  const first = source.split('\n', 1)[0]!.trim();
  return HEADER.test(first) ? source : null;
}
