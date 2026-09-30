import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
const serverFile=fileURLToPath(new URL('../server.mjs',import.meta.url));
async function start(dir,port='0'){
  const proc=spawn(process.execPath,[serverFile],{env:{...process.env,PAPERDESK_DATA:dir,PORT:port},stdio:['ignore','pipe','pipe']});
  let output='';
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{proc.kill();reject(Error('启动超时'));},10000);proc.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});proc.once('exit',code=>{clearTimeout(timer);reject(Error('启动失败 '+code));});});
  const html=await (await fetch(base)).text(),token=html.match(/name="app-token" content="([a-f0-9]+)"/)[1];
  return {proc,base,token,call:(url,options={})=>fetch(base+url,{...options,headers:{'X-PaperDesk-Token':token,...options.headers}}),stop:()=>new Promise(resolve=>{proc.once('exit',resolve);proc.kill();})};
}
test('文献完整生命周期、持久化与访问边界',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-test-'));let app;
  try{
    app=await start(dir);
    assert.equal((await fetch(app.base+'/api/papers')).status,403);
    assert.equal((await app.call('/api/papers',{headers:{Origin:'https://example.com'}})).status,403);
    const badHost=await new Promise((resolve,reject)=>{http.get(app.base+'/api/papers',{headers:{Host:'evil.example','X-PaperDesk-Token':app.token}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(badHost,403);
    assert.equal((await app.call('/api/import',{method:'POST',body:'not pdf'})).status,400);
    const pdf=Buffer.from('%PDF-1.4\n% test fixture\n%%EOF');
    const imported=await app.call('/api/import?name='+encodeURIComponent('论文测试.pdf'),{method:'POST',body:pdf});assert.equal(imported.status,201);
    const p=(await imported.json()).paper;
    assert.equal(p.title,'论文测试');
    assert.equal((await (await app.call('/api/import',{method:'POST',body:pdf})).json()).duplicate,true);
    const update={expectedRevision:1,title:'研究结果',notes:'  发现与思考 <script>test</script>\n\n',tags:['机器学习','机器学习'],status:'reading',favorite:true};
    const patched=await app.call('/api/papers/'+p.id,{method:'PATCH',body:JSON.stringify(update)});assert.equal(patched.status,200);assert.deepEqual((await patched.json()).tags,['机器学习']);
    assert.equal((await app.call('/api/papers/'+p.id,{method:'PATCH',body:'{"title":"","expectedRevision":2}'})).status,400);
    assert.equal((await app.call('/api/papers/'+p.id,{method:'PATCH',body:'{"status":"invalid","expectedRevision":2}'})).status,400);
    const partial=await app.call('/api/papers/'+p.id+'/file',{headers:{Range:'bytes=0-4'}});assert.equal(partial.status,206);assert.equal(await partial.text(),'%PDF-');
    assert.deepEqual(Buffer.from(await (await app.call('/api/papers/'+p.id+'/file')).arrayBuffer()),pdf);
    let revision=2;
    for(const trashed of [true,false]){const res=await app.call('/api/papers/'+p.id,{method:'PATCH',body:JSON.stringify({trashed,expectedRevision:revision++})});assert.equal((await res.json()).trashed,trashed);}
    assert.equal((await (await app.call('/api/export')).json()).papers.length,1);
    await app.stop();app=await start(dir);
    const saved=(await (await app.call('/api/papers')).json()).papers[0];assert.equal(saved.notes,update.notes);assert.equal(saved.favorite,true);assert.equal(saved.title,update.title);
    assert.equal(JSON.parse(await readFile(join(dir,'catalog.json'),'utf8')).papers.length,1);
  }finally{if(app&&app.proc.exitCode===null)await app.stop();await rm(dir,{recursive:true,force:true});}
});
test('默认端口占用时选择可用端口',async()=>{
  const blocker=http.createServer();await new Promise(r=>blocker.listen(0,'127.0.0.1',r));const port=blocker.address().port;
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-port-'));let app;
  try{app=await start(dir,String(port));assert.notEqual(new URL(app.base).port,String(port));assert.equal((await app.call('/api/papers')).status,200);}
  finally{if(app)await app.stop();await new Promise(r=>blocker.close(r));await rm(dir,{recursive:true,force:true});}
});

test('并发编辑只接受一个版本，冲突不覆盖笔记',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-conflict-'));let app;
  try{
    app=await start(dir);
    const p=(await (await app.call('/api/import',{method:'POST',body:'%PDF-1.4\nconflict\n%%EOF'})).json()).paper;
    const url='/api/papers/'+p.id;
    assert.equal((await app.call(url,{method:'PATCH',body:JSON.stringify({notes:'无版本'})})).status,428);
    const attempts=await Promise.all(['第一个页面','第二个页面'].map(notes=>app.call(url,{method:'PATCH',body:JSON.stringify({notes,expectedRevision:1})})));
    assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
    const winner=await attempts.find(r=>r.status===200).json();
    const saved=(await (await app.call('/api/papers')).json()).papers[0];
    assert.equal(saved.notes,winner.notes);assert.equal(saved.revision,2);
    // Hold an incomplete PATCH while a different page updates the record.
    let slow;
    const slowResult=new Promise((resolve,reject)=>{
      slow=http.request(app.base+url,{method:'PATCH',headers:{'X-PaperDesk-Token':app.token,'Content-Type':'application/json'}},r=>{r.resume();resolve(r.statusCode);});
      slow.on('error',reject);slow.write('{"notes":"延迟请求","expectedRevision":');
    });
    await new Promise(r=>setTimeout(r,30));
    const fresh=await app.call(url,{method:'PATCH',body:JSON.stringify({notes:'最新笔记',expectedRevision:2})});assert.equal(fresh.status,200);
    slow.end('2}');assert.equal(await slowResult,409);
    assert.equal((await (await app.call('/api/papers')).json()).papers[0].notes,'最新笔记');
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});

test('PDF 后缀范围、HEAD 与无效范围返回正确结果',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-range-'));let app;
  try{
    app=await start(dir);const bytes='%PDF-1.4\nrange\n%%EOF';
    const p=(await (await app.call('/api/import',{method:'POST',body:bytes})).json()).paper;
    const url='/api/papers/'+p.id+'/file';
    const suffix=await app.call(url,{headers:{Range:'bytes=-5'}});assert.equal(suffix.status,206);assert.equal(await suffix.text(),'%%EOF');
    const head=await app.call(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal(await head.text(),'');
    for(const range of ['bytes=-0','bytes=999-','bytes=9-2','bytes=-','bytes=0-1,3-4']){
      const r=await app.call(url,{headers:{Range:range}});assert.equal(r.status,416,range);assert.equal(r.headers.get('content-range'),'bytes */'+bytes.length);
    }
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});

test('旧文献库无需迁移，保存时添加版本号',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-legacy-'));let app;
  try{
    app=await start(dir);await app.call('/api/import',{method:'POST',body:'%PDF-1.4\nlegacy\n%%EOF'});await app.stop();app=null;
    const db=JSON.parse(await readFile(join(dir,'catalog.json'),'utf8'));delete db.papers[0].revision;await writeFile(join(dir,'catalog.json'),JSON.stringify(db));
    app=await start(dir);
    const res=await app.call('/api/papers/'+db.papers[0].id,{method:'PATCH',body:JSON.stringify({notes:'升级后保存',expectedRevision:0})});
    assert.equal(res.status,200);assert.equal((await res.json()).revision,1);
    await assert.rejects(start(dir),/启动失败/);
    assert.equal((await app.call('/api/papers')).status,200);
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});


test('备份 API 与恢复命令可恢复可启动的完整文献库',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-backup-api-'));let app,restored;
  try{
    app=await start(join(dir,'original'));
    const paper=(await (await app.call('/api/import?name=example.pdf',{method:'POST',body:'%PDF-1.4\nbackup api\n%%EOF'})).json()).paper;
    const backupResponse=await app.call('/api/backup',{method:'POST'});assert.equal(backupResponse.status,201);
    const backup=await backupResponse.json();assert.equal(backup.count,1);
    const target=join(dir,'restored');
    const script=fileURLToPath(new URL('../scripts/restore.mjs',import.meta.url));
    execFileSync(process.execPath,[script,backup.path,target]);
    restored=await start(target);
    const restoredPaper=(await (await restored.call('/api/papers')).json()).papers[0];
    assert.equal(restoredPaper.id,paper.id);
    assert.equal(await (await restored.call('/api/papers/'+paper.id+'/file')).text(),'%PDF-1.4\nbackup api\n%%EOF');
    assert.equal((await app.call('/api/papers')).status,200);
    const bib=await app.call('/api/export.bib?id='+paper.id);assert.equal(bib.status,200);assert.match(await bib.text(),/@misc/);
    assert.equal((await app.call('/api/export.bib?id=missing')).status,404);
    await app.call('/api/papers/'+paper.id,{method:'PATCH',body:JSON.stringify({trashed:true,expectedRevision:1})});
    assert.equal((await app.call('/api/export.bib?id='+paper.id)).status,404);
    assert.equal((await (await app.call('/api/export.bib')).text()).trim(),'');
  }finally{
    if(restored)await restored.stop();if(app)await app.stop();await rm(dir,{recursive:true,force:true});
  }
});

test('批量接口一次持久化，冲突或非法请求不部分写入',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-batch-api-'));let app;
  try{
    app=await start(dir);
    const ps=[];
    for(let i=0;i<3;i++)ps.push((await (await app.call('/api/import?name='+i+'.pdf',{method:'POST',body:'%PDF-1.4\nbatch '+i+'\n%%EOF'})).json()).paper);
    const items=ps.slice(0,2).map(p=>({id:p.id,expectedRevision:1}));
    const send=(request)=>app.call('/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    assert.equal((await fetch(app.base+'/api/batch',{method:'POST',body:'{}'})).status,403);
    const response=await send({items,action:'addTag',value:'测试标签'});assert.equal(response.status,200);assert.equal((await response.json()).count,2);
    const disk=await readFile(join(dir,'catalog.json'),'utf8');
    const stale=[{id:ps[0].id,expectedRevision:2},{id:ps[1].id,expectedRevision:1}];
    assert.equal((await send({items:stale,action:'trash'})).status,409);
    assert.equal(await readFile(join(dir,'catalog.json'),'utf8'),disk);
    assert.equal((await send({items:ps.slice(0,2).map(p=>({id:p.id,expectedRevision:2})),action:'removeTag',value:'标签一,标签二'})).status,400);
    assert.equal(await readFile(join(dir,'catalog.json'),'utf8'),disk);
    await app.stop();app=await start(dir);
    let saved=(await (await app.call('/api/papers')).json()).papers;
    assert.deepEqual(saved.find(p=>p.id===ps[0].id).tags,['测试标签']);
    assert.deepEqual(saved.find(p=>p.id===ps[2].id).tags,[]);
    assert.equal(saved.find(p=>p.id===ps[2].id).revision,1);
    for(const action of ['trash','restore']){
      const selected=saved.filter(p=>p.id!==ps[2].id).map(p=>({id:p.id,expectedRevision:p.revision}));
      const result=await app.call('/api/batch',{method:'POST',body:JSON.stringify({items:selected,action})});assert.equal(result.status,200);
      saved=(await (await app.call('/api/papers')).json()).papers;
      assert.equal(saved.find(p=>p.id===ps[0].id).trashed,action==='trash');
      assert.equal((await app.call('/api/papers/'+ps[0].id+'/file')).status,200);
    }
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});

test('批量更新与单篇保存竞争时不互相覆盖',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-batch-race-'));let app;
  try{
    app=await start(dir);
    const ps=[];
    for(let i=0;i<2;i++)ps.push((await (await app.call('/api/import',{method:'POST',body:'%PDF-1.4\nrace '+i+'\n%%EOF'})).json()).paper);
    const [batch,single]=await Promise.all([
      app.call('/api/batch',{method:'POST',body:JSON.stringify({items:ps.map(p=>({id:p.id,expectedRevision:1})),action:'favorite',value:true})}),
      app.call('/api/papers/'+ps[1].id,{method:'PATCH',body:JSON.stringify({expectedRevision:1,notes:'单篇保存'})}),
    ]);
    assert.deepEqual([batch.status,single.status].sort(),[200,409]);
    const saved=(await (await app.call('/api/papers')).json()).papers;
    if(batch.status===200){assert.equal(saved.every(p=>p.favorite),true);assert.equal(saved.every(p=>p.notes===''),true);}
    else{assert.equal(saved.every(p=>!p.favorite),true);assert.equal(saved.find(p=>p.id===ps[1].id).notes,'单篇保存');assert.equal(saved.find(p=>p.id===ps[0].id).revision,1);}
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});

test('自动导入分类、规则预览应用、智能设置持久化',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-classify-api-'));let app;
  try{
    app=await start(dir);
    const js=await fetch(app.base+'/classify.mjs');assert.match(js.headers.get('content-type'),/javascript/);assert.equal(js.status,200);
    const auto=(await (await app.call('/api/import?name=UWB_localization_survey.pdf',{method:'POST',body:'%PDF-1.4\nauto classify\n%%EOF'})).json()).paper;
    assert.ok(auto.tags.includes('定位与导航'));assert.ok(auto.tags.includes('综述'));
    const rules=[{tag:'定位专题',keywords:['UWB']}];
    const save=await app.call('/api/classify/apply',{method:'POST',body:JSON.stringify({items:[],rules,autoOnImport:false,expectedSettingsRevision:0})});assert.equal(save.status,200);
    const manual=(await (await app.call('/api/import?name=UWB_manual.pdf',{method:'POST',body:'%PDF-1.4\nmanual classify\n%%EOF'})).json()).paper;assert.deepEqual(manual.tags,[]);
    const preview=await (await app.call('/api/classify/preview',{method:'POST',body:JSON.stringify({rules})})).json();assert.equal(preview.total,2);
    const selected=preview.suggestions.filter(p=>p.id===manual.id);
    const applied=await app.call('/api/classify/apply',{method:'POST',body:JSON.stringify({items:selected,rules,autoOnImport:false,expectedSettingsRevision:1})});assert.equal(applied.status,200);
    assert.deepEqual((await applied.json()).papers[0].tags,['定位专题']);
    const stale=await app.call('/api/classify/apply',{method:'POST',body:JSON.stringify({items:[],rules:[],autoOnImport:true,expectedSettingsRevision:1})});assert.equal(stale.status,409);
    await app.stop();app=await start(dir);
    const stored=await (await app.call('/api/classify/settings')).json();assert.deepEqual(stored.rules,rules);assert.equal(stored.autoOnImport,false);assert.equal(stored.revision,2);
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});

test('彻底清除接口校验确认文字和回收站状态，清除后可重新导入',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paperdesk-purge-api-'));let app;
  try{
    app=await start(dir);const bytes='%PDF-1.4\npurge api\n%%EOF';
    const p=(await (await app.call('/api/import',{method:'POST',body:bytes})).json()).paper;
    const purge=(items,confirmation)=>app.call('/api/purge',{method:'POST',body:JSON.stringify({items,confirmation})});
    assert.equal((await purge([{id:p.id,expectedRevision:1}],'永久删除 1 篇')).status,409);
    await app.call('/api/papers/'+p.id,{method:'PATCH',body:JSON.stringify({trashed:true,expectedRevision:1})});
    assert.equal((await purge([{id:p.id,expectedRevision:2}],'确定')).status,400);
    assert.equal((await purge([{id:p.id,expectedRevision:1}],'永久删除 1 篇')).status,409);
    const success=await purge([{id:p.id,expectedRevision:2}],'永久删除 1 篇');assert.equal(success.status,200);assert.equal((await success.json()).count,1);
    assert.equal((await app.call('/api/papers/'+p.id+'/file')).status,404);
    const again=(await (await app.call('/api/import',{method:'POST',body:bytes})).json());assert.equal(again.duplicate,false);assert.notEqual(again.paper.id,p.id);
    await app.stop();app=await start(dir);
    assert.equal((await (await app.call('/api/papers')).json()).papers.length,1);
    assert.equal(await (await app.call('/api/papers/'+again.paper.id+'/file')).text(),bytes);
  }finally{if(app)await app.stop();await rm(dir,{recursive:true,force:true});}
});
