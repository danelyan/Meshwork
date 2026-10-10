import { buildGraph } from '@/components/landing/graph-model';
import { SHOWCASE } from '@/components/landing/showcase';

it('uses sourced company logos without fabricated matching percentages', () => {
  const {nodes, edges} = buildGraph();
  expect(nodes.filter(n => n.id.startsWith('c')).map(n => [n.label,n.logoSrc])).toEqual(SHOWCASE.companies.slice(0,5).map(c=>[c.name,c.logoSrc]));
  expect(edges.filter(e=>e.mine).map(e=>e.mine)).toEqual([true,true,true,true,true]);
  expect(nodes.find(n=>n.id==='x2')).toMatchObject({kind:'co',label:'VK',logoSrc:'/assets/companies/vk.png'});
  expect(nodes.find(n=>n.id==='x5')).toMatchObject({kind:'co',label:'МТС',logoSrc:'/assets/companies/mts.svg'});
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
