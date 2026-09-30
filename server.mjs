import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(process.env.PAPERDESK_DATA || path.join(os.homedir(),'PaperDeskData'));
fs.mkdirSync(path.join(data,'files'),{recursive:true,mode:0o700});
const lock=path.join(data,'running.lock');
try { fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600}); }
catch { console.error(`文栖数据目录已锁定。请关闭其他文栖窗口对应的终端。\n若上次异常退出，请确认文栖进程已停止，再删除 ${lock}`); process.exit(1); }
process.on('exit',()=>{try{fs.unlinkSync(lock);}catch{}});
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>process.exit(0));
const dbPath=path.join(data,'catalog.json');
let db={version:1,papers:[]};
if(fs.existsSync(dbPath)) { db=JSON.parse(fs.readFileSync(dbPath,'utf8')); if(db.version!==1||!Array.isArray(db.papers)) throw Error('文献数据库格式不受支持'); }
function commit(next) {
  const temp=dbPath+'.tmp';
  const fd=fs.openSync(temp,'w',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(next,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fs.existsSync(dbPath)) fs.copyFileSync(dbPath,dbPath+'.bak');
  fs.renameSync(temp,dbPath); db=next;
}
const token=randomBytes(32).toString('hex');
let origin;
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
    if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
      const f=url.pathname==='/'?'index.html':url.pathname.slice(1);
      let bytes=fs.readFileSync(path.join(root,'public',f));
      if(f==='index.html')bytes=Buffer.from(bytes.toString().replace('__TOKEN__',token));
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
      res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');return res.end(bytes);
    }
    if((req.headers['x-paperdesk-token']||url.searchParams.get('token'))!==token)fail(403,'请刷新页面后重试');
    if(req.method==='GET'&&url.pathname==='/api/papers')return send({papers:db.papers,dataPath:data});
    if(req.method==='POST'&&url.pathname==='/api/import'){
      const bytes=await body(req,50*1024*1024);
      if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))fail(400,'文件不是有效的 PDF');
      const hash=createHash('sha256').update(bytes).digest('hex');
      const existing=db.papers.find(p=>p.hash===hash);
      if(existing)return send({paper:existing,duplicate:true});
      const name=(url.searchParams.get('name')||'未命名.pdf').slice(0,500);
      const paper={id:randomUUID(),hash,filename:name,title:name.replace(/\.pdf$/i,''),authors:'',year:'',doi:'',journal:'',tags:[],notes:'',status:'unread',favorite:false,trashed:false,createdAt:new Date().toISOString(),size:bytes.length};
      fs.writeFileSync(path.join(data,'files',hash+'.pdf'),bytes,{mode:0o600});
      commit({...db,papers:[paper,...db.papers]});return send({paper,duplicate:false},201);
    }
    const match=url.pathname.match(/^\/api\/papers\/([a-f0-9-]+)(\/file)?$/);
    if(match){
      const paper=db.papers.find(p=>p.id===match[1]);if(!paper)fail(404,'文献不存在');
      if(req.method==='GET'&&match[2]){
        const file=path.join(data,'files',paper.hash+'.pdf');
        if(!fs.existsSync(file))fail(404,'PDF 文件丢失，请从备份恢复');
        const stat=fs.statSync(file);let start=0,end=stat.size-1,status=200;
        if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range)fail(416,'范围无效');start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end)fail(416,'范围无效');status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);}
        res.writeHead(status,{'Content-Type':'application/pdf','Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Disposition':`inline; filename="paper.pdf"; filename*=UTF-8''${encodeURIComponent(paper.filename)}`});
        const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      if(req.method==='PATCH'&&!match[2]){
        const changes=await json(req);if(!changes||Array.isArray(changes)||typeof changes!=='object')fail(400,'请求格式错误');
        const next={...paper};
        for(const key of ['title','authors','year','doi','journal','notes'])if(key in changes){if(typeof changes[key]!=='string'||changes[key].length>(key==='notes'?100000:2000))fail(400,'字段过长或格式错误');next[key]=changes[key].trim();}
        if(!next.title)fail(400,'标题不能为空');
        if('tags'in changes){if(!Array.isArray(changes.tags)||changes.tags.length>50||changes.tags.some(t=>typeof t!=='string'||t.length>80))fail(400,'标签格式错误');next.tags=[...new Set(changes.tags.map(t=>t.trim()).filter(Boolean))];}
        if('status'in changes){if(!['unread','reading','done'].includes(changes.status))fail(400,'阅读状态无效');next.status=changes.status;}
        for(const key of ['favorite','trashed'])if(key in changes){if(typeof changes[key]!=='boolean')fail(400,'字段格式错误');next[key]=changes[key];}
        next.updatedAt=new Date().toISOString();commit({...db,papers:db.papers.map(p=>p.id===next.id?next:p)});return send(next);
      }
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
