import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const reject=(status,message)=>{throw Object.assign(new Error(message),{status});};
const isHash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);

// Reconcile interrupted deletion with the durable catalog before serving requests.
export function recoverDeletions(data,catalog){
  const root=path.join(data,'deletions');if(!fs.existsSync(root))return;
  const active=new Set(catalog.papers.map(p=>p.hash));
  for(const name of fs.readdirSync(root)){
    if(!/^[a-f0-9-]{36}$/.test(name))continue;
    const stage=path.join(root,name);if(!fs.lstatSync(stage).isDirectory())throw Error('清理暂存目录异常');
    const entries=fs.readdirSync(stage);
    let manifest;
    try{manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));}
    catch(error){if(entries.every(n=>n==='manifest.json')){fs.rmSync(stage,{recursive:true});continue;}throw error;}
    if(manifest.format!=='paperdesk-purge'||!Array.isArray(manifest.hashes)||!manifest.hashes.every(isHash))throw Error('清理日志无效');
    for(const hash of manifest.hashes){
      const staged=path.join(stage,hash+'.pdf'),original=path.join(data,'files',hash+'.pdf');
      if(!active.has(hash)||!fs.existsSync(staged))continue;
      if(fs.existsSync(original)){
        if(createHash('sha256').update(fs.readFileSync(original)).digest('hex')!==hash)throw Error('清理恢复遇到文件冲突，请保留数据目录');
      }else fs.renameSync(staged,original);
    }
    fs.rmSync(stage,{recursive:true});
  }
}

export function purgeTrashed(data,catalog,request,commit){
  const items=request?.items;
  if(!Array.isArray(items)||items.length<1||items.length>10000)reject(400,'每次清除 1 至 10000 篇回收站文献');
  if(request.confirmation!==`永久删除 ${items.length} 篇`)reject(400,'请完整输入页面显示的删除确认文字');
  const selected=new Map(),byId=new Map(catalog.papers.map(p=>[p.id,p]));
  for(const item of items){
    if(!item||typeof item.id!=='string'||!Number.isSafeInteger(item.expectedRevision)||selected.has(item.id))reject(400,'删除选择无效或重复');
    const p=byId.get(item.id);
    if(!p||!p.trashed||(p.revision||0)!==item.expectedRevision)reject(409,'回收站已变化，请重新确认；本次未清除任何文献');
    selected.set(p.id,p);
  }
  recoverDeletions(data,catalog);
  const stage=path.join(data,'deletions',randomUUID());fs.mkdirSync(stage,{recursive:true,mode:0o700});
  const fd=fs.openSync(path.join(stage,'manifest.json'),'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({format:'paperdesk-purge',hashes:[...selected.values()].map(p=>p.hash)}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{
    for(const p of selected.values()){
      const file=path.join(data,'files',p.hash+'.pdf');
      if(fs.existsSync(file)){
        if(!fs.lstatSync(file).isFile())throw Error('PDF 路径不是普通文件');
        fs.renameSync(file,path.join(stage,p.hash+'.pdf'));
      }
    }
    commit({...catalog,papers:catalog.papers.filter(p=>!selected.has(p.id))});
  }catch(error){recoverDeletions(data,catalog);throw error;}
  let warning=null;
  try{fs.rmSync(stage,{recursive:true});}catch{warning='书目已清除，部分暂存文件未能释放空间；下次启动会继续清理。';}
  return {ids:[...selected.keys()],count:selected.size,warning};
}
