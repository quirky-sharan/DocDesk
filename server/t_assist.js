const B='http://127.0.0.1:5000/api';
async function post(path, body){ const r=await fetch(B+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const j=await r.json(); if(!r.ok) throw new Error(r.status+' '+j.error); return j; }
function show(label, t0, j){
  console.log(`\n### ${label}  (${Date.now()-t0}ms, ${j.model})`);
  console.log('reply  :', j.reply.replace(/\n/g,' ⏎ ').slice(0,300));
  if (j.activity?.length) console.log('tools  :', j.activity.map(a=>a.tool+':'+a.state+(a.label?'('+a.label.slice(0,60)+')':'')).join(' | '));
  if (j.actions?.length) console.log('actions:', JSON.stringify(j.actions).slice(0,200));
  if (j.blocks?.length) console.log('blocks :', j.blocks.map(b=>b.type+(b.rows?'['+b.rows.length+']':'')).join(', '));
  if (j.pending?.length) j.pending.forEach(p=>console.log('PENDING:', p.summary, '|', JSON.stringify(p.lines)));
}
(async()=>{
  const status = await (await fetch(B+'/ai/status?probe=1')).json();
  console.log('status:', JSON.stringify({configured:status.configured, reachable:status.reachable, model:status.model}));
  const cases = [
    ['how are we doing today?', '/'],
    ['show me the 5 most expensive products', '/'],
    ['which customers have spent the most this month?', '/customers'],
  ];
  for (const [text, page] of cases) {
    const t0=Date.now();
    try { show(text, t0, await post('/assistant/message',{text, page, messages:[]})); }
    catch(e){ console.log('\n### '+text+'\nERROR:', e.message); }
  }
})();
