import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
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
    const update={title:'研究结果',notes:'发现与思考 <script>test</script>',tags:['机器学习','机器学习'],status:'reading',favorite:true};
    const patched=await app.call('/api/papers/'+p.id,{method:'PATCH',body:JSON.stringify(update)});assert.equal(patched.status,200);assert.deepEqual((await patched.json()).tags,['机器学习']);
    assert.equal((await app.call('/api/papers/'+p.id,{method:'PATCH',body:'{"title":""}'})).status,400);
    assert.equal((await app.call('/api/papers/'+p.id,{method:'PATCH',body:'{"status":"invalid"}'})).status,400);
    const partial=await app.call('/api/papers/'+p.id+'/file',{headers:{Range:'bytes=0-4'}});assert.equal(partial.status,206);assert.equal(await partial.text(),'%PDF-');
    assert.deepEqual(Buffer.from(await (await app.call('/api/papers/'+p.id+'/file')).arrayBuffer()),pdf);
    for(const trashed of [true,false]){const res=await app.call('/api/papers/'+p.id,{method:'PATCH',body:JSON.stringify({trashed})});assert.equal((await res.json()).trashed,trashed);}
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
