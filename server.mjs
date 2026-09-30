import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createBackup, validateCatalog} from './lib/archive.mjs';
import {toBibtex} from './lib/bibtex.mjs';
import {applyBatch} from './lib/batch.mjs';
import {settings,suggestTags,previewClassification,applyClassification} from './lib/classify.mjs';
import {purgeTrashed,recoverDeletions} from './lib/purge.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(process.env.PAPERDESK_DATA || path.join(os.homedir(),'PaperDeskData'));
fs.mkdirSync(path.join(data,'files'),{recursive:true,mode:0o700});
const lock=path.join(data,'running.lock');
try { fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600}); }
catch(error) { if(error.code!=='EEXIST'){console.error(`无法创建运行锁，请检查数据目录权限和磁盘空间：${data}`);process.exit(1);} console.error(`文栖数据目录已锁定。请关闭其他文栖窗口对应的终端。\n若上次异常退出，请确认文栖进程已停止，再删除 ${lock}`); process.exit(1); }
process.on('exit',()=>{try{fs.unlinkSync(lock);}catch{}});
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>process.exit(0));
const dbPath=path.join(data,'catalog.json');
let db={version:1,papers:[]};
if(fs.existsSync(dbPath)) {
  try{db=validateCatalog(JSON.parse(fs.readFileSync(dbPath,'utf8')));}
  catch(error){console.error(`无法读取文献库：${error.message}\n原文件未修改：${dbPath}\n请先保留原目录，再使用完整备份恢复到新目录。`);process.exit(1);}
}
try{if(!fs.existsSync(dbPath)&&fs.existsSync(path.join(data,'deletions'))&&fs.readdirSync(path.join(data,'deletions')).length)throw Error('书目丢失，不能判断清除是否完成');recoverDeletions(data,db);}catch(error){console.error('未完成的清除操作恢复失败，请保留数据目录：'+error.message);process.exit(1);}
function commit(next) {
  const temp=dbPath+'.tmp';
  const fd=fs.openSync(temp,'w',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(next,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fs.existsSync(dbPath)) fs.copyFileSync(dbPath,dbPath+'.bak');
  fs.renameSync(temp,dbPath); db=next;
}
const token=randomBytes(32).toString('hex');
let origin;
let backupBusy=false;
function fail(status,message){throw Object.assign(new Error(message),{status});}
async function body(req,max=1024*1024){let size=0;const parts=[];for await(const p of req){size+=p.length;if(size>max)fail(413,'文件过大，单个 PDF 最大 50 MB');parts.push(p);}return Buffer.concat(parts);}
async function json(req){try{return JSON.parse((await body(req)).toString());}catch(e){if(e.status)throw e;fail(400,'请求格式错误');}}
const server=http.createServer(async(req,res)=>{
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  try{
    if(req.headers.host!==new URL(origin).host)fail(403,'访问地址不受支持');
    if(req.headers.origin && req.headers.origin!==origin)fail(403,'不允许跨站访问');
    const url=new URL(req.url,origin);
    if(req.method==='GET'&&['/','/app.js','/style.css','/classify.mjs'].includes(url.pathname)){
      const f=url.pathname==='/'?'index.html':url.pathname.slice(1);
      let bytes=fs.readFileSync(f==='classify.mjs'?path.join(root,'lib','classify.mjs'):path.join(root,'public',f));
      if(f==='index.html')bytes=Buffer.from(bytes.toString().replace('__TOKEN__',token));
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
      res.setHeader('Content-Type',(f.endsWith('.js')||f.endsWith('.mjs'))?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');return res.end(bytes);
    }
    if((req.headers['x-paperdesk-token']||url.searchParams.get('token'))!==token)fail(403,'请刷新页面后重试');
    if(req.method==='GET'&&url.pathname==='/api/papers')return send({papers:db.papers,dataPath:data,classification:settings(db)});
    if(req.method==='GET'&&url.pathname==='/api/classify/settings')return send(settings(db));
    if(req.method==='POST'&&url.pathname==='/api/classify/preview'){
      const request=await json(req);const suggestions=previewClassification(db,request?.rules);
      return send({suggestions:suggestions.slice(0,500),total:suggestions.length});
    }
    if(req.method==='POST'&&url.pathname==='/api/classify/apply'){
      const request=await json(req);const result=applyClassification(db,request);
      commit(result.catalog);return send({papers:result.papers,count:result.papers.length,classification:settings(db)});
    }
    if(req.method==='POST'&&url.pathname==='/api/purge'){
      const request=await json(req);
      if(backupBusy)fail(409,'完整备份正在进行，请完成后再清除');
      return send(purgeTrashed(data,db,request,commit));
    }
    if(req.method==='POST'&&url.pathname==='/api/batch'){
      const request=await json(req);
      const result=applyBatch(db,request);
      commit(result.catalog);
      return send({papers:result.papers,count:result.papers.length});
    }
    if(req.method==='POST'&&url.pathname==='/api/import'){
      const bytes=await body(req,50*1024*1024);
      if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))fail(400,'文件不是有效的 PDF');
      const hash=createHash('sha256').update(bytes).digest('hex');
      const existing=db.papers.find(p=>p.hash===hash);
      if(existing)return send({paper:existing,duplicate:true});
      const name=(url.searchParams.get('name')||'未命名.pdf').slice(0,500);
      const paper={id:randomUUID(),revision:1,hash,filename:name,title:name.replace(/\.pdf$/i,'').trim()||'未命名文献',authors:'',year:'',doi:'',journal:'',tags:[],notes:'',status:'unread',favorite:false,trashed:false,createdAt:new Date().toISOString(),size:bytes.length};
      const config=settings(db);if(config.autoOnImport)paper.tags=suggestTags(paper,config.rules).map(m=>m.tag);
      fs.writeFileSync(path.join(data,'files',hash+'.pdf'),bytes,{mode:0o600});
      commit({...db,papers:[paper,...db.papers]});return send({paper,duplicate:false},201);
    }
    const match=url.pathname.match(/^\/api\/papers\/([a-f0-9-]+)(\/file)?$/);
    if(match){
      let paper=db.papers.find(p=>p.id===match[1]);if(!paper)fail(404,'文献不存在');
      if(['GET','HEAD'].includes(req.method)&&match[2]){
        const file=path.join(data,'files',paper.hash+'.pdf');
        if(!fs.existsSync(file))fail(404,'PDF 文件丢失，请从备份恢复');
        const stat=fs.statSync(file);let start=0,end=stat.size-1,status=200;
        if(req.headers.range&&req.method==='GET'){
          const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          const invalid=()=>{res.setHeader('Content-Range',`bytes */${stat.size}`);fail(416,'范围无效');};
          if(!range||(!range[1]&&!range[2]))invalid();
          if(range[1]){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}
          else{const suffix=Number(range[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)invalid();start=Math.max(0,stat.size-suffix);}
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end)invalid();
          status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);
        }
        res.writeHead(status,{'Content-Type':'application/pdf','Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Disposition':`inline; filename="paper.pdf"; filename*=UTF-8''${encodeURIComponent(paper.filename)}`});
        if(req.method==='HEAD')return res.end();
        const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      if(req.method==='PATCH'&&!match[2]){
        const changes=await json(req);if(!changes||Array.isArray(changes)||typeof changes!=='object')fail(400,'请求格式错误');
        // The body may arrive slowly; read the latest record only after it is complete.
        paper=db.papers.find(p=>p.id===match[1]);
        if(!paper)fail(409,'文献已被清除，请刷新列表');
        if(!Number.isSafeInteger(changes.expectedRevision))fail(428,'页面版本过旧，请刷新页面后再保存');
        if(changes.expectedRevision!==(paper.revision||0))fail(409,'此文献已在其他页面更新。你的草稿仍保留，请复制需要的内容，再重新载入最新版本。');
        const next={...paper};
        for(const key of ['title','authors','year','doi','journal','notes'])if(key in changes){if(typeof changes[key]!=='string'||changes[key].length>(key==='notes'?100000:2000))fail(400,'字段过长或格式错误');next[key]=key==='notes'?changes[key]:changes[key].trim();}
        if(!next.title)fail(400,'标题不能为空');
        if('tags'in changes){if(!Array.isArray(changes.tags)||changes.tags.length>50||changes.tags.some(t=>typeof t!=='string'||t.length>80))fail(400,'标签格式错误');next.tags=[...new Set(changes.tags.map(t=>t.trim()).filter(Boolean))];}
        if('status'in changes){if(!['unread','reading','done'].includes(changes.status))fail(400,'阅读状态无效');next.status=changes.status;}
        for(const key of ['favorite','trashed'])if(key in changes){if(typeof changes[key]!=='boolean')fail(400,'字段格式错误');next[key]=changes[key];}
        next.revision=(paper.revision||0)+1;
        next.updatedAt=new Date().toISOString();commit({...db,papers:db.papers.map(p=>p.id===next.id?next:p)});return send(next);
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/backup'){
      if(backupBusy)fail(409,'已有备份正在进行，请等待完成');
      backupBusy=true;
      try{return send(await createBackup(data,db),201);}
      catch(error){fail(500,'备份未完成，原文献库未改动。'+error.message);}
      finally{backupBusy=false;}
    }
    if(req.method==='GET'&&url.pathname==='/api/export.bib'){
      const id=url.searchParams.get('id');
      const selected=id?db.papers.filter(p=>p.id===id&&!p.trashed):db.papers;
      if(id&&!selected.length)fail(404,'文献不存在或已在回收站');
      res.writeHead(200,{'Content-Type':'application/x-bibtex; charset=utf-8','Content-Disposition':'attachment; filename="paperdesk-references.bib"'});
      return res.end(toBibtex(selected));
    }
    if(req.method==='GET'&&url.pathname==='/api/export'){
      res.setHeader('Content-Disposition','attachment; filename="paperdesk-catalog.json"');return send(db);
    }
    fail(404,'地址不存在');
  }catch(e){if(!res.headersSent)send({error:e.status?e.message:'操作失败，请检查数据目录权限或磁盘空间；数据未成功保存。'},e.status||500);else res.destroy();if(!e.status)console.error(e);}
});
server.requestTimeout=120000;
server.on('error',e=>{if(e.code==='EADDRINUSE')server.listen(0,'127.0.0.1');else{console.error(e);process.exit(1);}});
server.on('listening',()=>{
  origin=`http://127.0.0.1:${server.address().port}`;
  console.log(`文栖已启动：${origin}\n数据目录：${data}\n关闭程序：在此终端按 Control+C`);
  if(process.argv.includes('--open')){
    const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';
    const child=spawn(command,[origin],{stdio:'ignore'});child.on('error',()=>console.log('请手动打开上面的地址。'));child.unref();
  }
});
server.listen(Number(process.env.PORT||4321),'127.0.0.1');
