export type NodeKind = 'me' | 'co' | 'st';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Подпись под узлом. */
  label?: string;
  /** Буква компании. */
  letter?: string;
  /** Позиция на десктопе, % (как в мокапе: x масштабируется 6 + x*0.8, кроме узлов x*). */
  pos: [number, number];
  /** Позиция на мобильном (≤640px); нет — узел скрыт. */
  mobile?: [number, number];
}

export interface GraphEdge {
  a: string;
  b: string;
  /** Иллюстративный процент из исходного мокапа. */
  mine?: string;
}

// Слоты компаний: [десктоп x, y], мобильная позиция — из мокапа (heroPositions).
const SLOTS: Array<{ pos: [number, number]; mobile: [number, number] }> = [
  { pos: [50, 15], mobile: [50, 12] },
  { pos: [84, 33], mobile: [83, 34] },
  { pos: [80, 77], mobile: [76, 78] },
  { pos: [16, 31], mobile: [17, 34] },
  { pos: [22, 77], mobile: [24, 78] },
];

const scale = (p: [number, number]): [number, number] => [6 + p[0] * 0.8, p[1]];

// Анонимные «соседи» графа — декоративные силуэты (ники из мокапа, не реальные люди).
const STRANGERS: Array<[string, string | undefined, [number, number]]> = [
  ['s1', 'Happy Panda', [33, 12]], ['s2', 'Quiet Fox', [68, 10]], ['s3', 'Blue Otter', [94, 56]], ['s4', 'Lucky Koala', [60, 91]],
  ['s5', 'Swift Falcon', [6, 55]], ['s6', 'Brave Penguin', [38, 91]], ['s7', undefined, [72, 58]], ['s8', undefined, [30, 52]], ['s9', undefined, [58, 30]],
];
// Дальний план за правым краем экрана (как в мокапе, не масштабируется).
const FAR: Array<[string, [number, number]]> = [
  ['x1', [91, 2]], ['x2', [98, 22]], ['x3', [104, 45]], ['x4', [92, 99]], ['x5', [99, 75]], ['x6', [78, 108]],
  ['x7', [112, 6]], ['x8', [116, 60]], ['x9', [124, 30]], ['x10', [110, 93]], ['x11', [130, 48]],
];

// Связи соседей (c0..c4 — слоты компаний; отсутствующие слоты отбрасываются).
const LINKS: Array<[string, string]> = [
  ['s1', 'c0'], ['s1', 'c3'], ['s2', 'c0'], ['s2', 'c1'], ['s3', 'c1'], ['s3', 'c2'], ['s4', 'c2'], ['s4', 'c4'], ['s5', 'c3'], ['s5', 'c4'],
  ['s6', 'c4'], ['s6', 'c2'], ['s7', 'c1'], ['s7', 'c2'], ['s8', 'c3'], ['s8', 'c4'], ['s9', 'c0'], ['s9', 'c1'], ['s2', 'x1'], ['s2', 'x2'],
  ['c1', 'x2'], ['c1', 'x3'], ['s3', 'x3'], ['s3', 'x5'], ['c2', 'x5'], ['s4', 'x4'], ['s4', 'x6'], ['c2', 'x4'], ['x2', 'x3'], ['x5', 'x4'],
  ['x1', 'x7'], ['x2', 'x7'], ['x3', 'x8'], ['x5', 'x8'], ['x2', 'x9'], ['x3', 'x9'], ['x8', 'x11'], ['x9', 'x11'], ['x5', 'x10'], ['x4', 'x10'], ['x3', 'x5'],
];

export function buildGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [{ id: 'me', kind: 'me', label: 'Вы', pos: scale([50, 50]), mobile: [50, 52] }];
  const edges: GraphEdge[] = [];
  const companies = [['North', '92%'], ['Vector', '84%'], ['Forma', '68%'], ['Orbit', '61%'], ['Atlas', '46%']];
  companies.forEach(([name, percent], i) => {
    const slot = SLOTS[i]!;
    nodes.push({ id: `c${i}`, kind: 'co', label: name, letter: name!.charAt(0), pos: scale(slot.pos), mobile: [slot.mobile[0], i === 2 || i === 4 ? 82 : slot.mobile[1]] });
    edges.push({ a: 'me', b: `c${i}`, mine: percent });
  });
  for (const [id, label, p] of STRANGERS) nodes.push({ id, kind: 'st', label, pos: scale(p) });
  for (const [id, p] of FAR) {
    const name = id === 'x2' ? 'Kernel' : id === 'x5' ? 'Tensor' : undefined;
    const letter = name?.charAt(0) ?? (id === 'x11' ? 'M' : undefined);
    nodes.push({ id, kind: letter ? 'co' : 'st', label: name, letter, pos: p });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const [a, b] of LINKS) if (ids.has(a) && ids.has(b)) edges.push({ a, b });
  return { nodes, edges };
}
