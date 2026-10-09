import { buildGraph } from '@/components/landing/graph-model';

it('restores the original illustrated companies and matching percentages', () => {
  const {nodes, edges} = buildGraph();
  expect(nodes.filter(n => n.id.startsWith('c')).map(n => [n.label,n.letter])).toEqual([
    ['North','N'],['Vector','V'],['Forma','F'],['Orbit','O'],['Atlas','A'],
  ]);
  expect(edges.filter(e=>e.mine).map(e=>e.mine)).toEqual(['92%','84%','68%','61%','46%']);
  expect(nodes.find(n=>n.id==='x2')).toMatchObject({kind:'co',label:'Kernel',letter:'K'});
  expect(nodes.find(n=>n.id==='x5')).toMatchObject({kind:'co',label:'Tensor',letter:'T'});
});

it('retains the reference topology and mobile slots', () => {
  const {nodes,edges}=buildGraph();
  expect(nodes).toHaveLength(26);
  expect(nodes.find(n=>n.id==='me')?.pos).toEqual([46,50]);
  expect(edges).toHaveLength(46);
  const ids = new Set(nodes.map(n=>n.id));
  expect(edges.every(e=>ids.has(e.a)&&ids.has(e.b))).toBe(true);
  expect(nodes.filter(n=>n.mobile).map(n=>n.id)).toEqual(['me','c0','c1','c2','c3','c4']);
  expect(nodes.find(n=>n.id==='c2')?.mobile).toEqual([76,82]);
});
