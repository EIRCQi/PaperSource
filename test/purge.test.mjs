import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {purgeTrashed,recoverDeletions} from '../lib/purge.mjs';

function fixture(){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'paperdesk-purge-'));
  fs.mkdirSync(path.join(data,'files'));
  const papers=[0,1].map(i=>{
    const bytes=Buffer.from('%PDF-1.4\npurge '+i);const hash=createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(data,'files',hash+'.pdf'),bytes);
    return {id:randomUUID(),hash,revision:1,trashed:true};
  });
  return {data,catalog:{version:1,papers},request:{items:papers.map(p=>({id:p.id,expectedRevision:1})),confirmation:'永久删除 2 篇'}};
}
test('清除仅删除回收站库内副本，不触及原文件或备份',()=>{
  const f=fixture();try{
    const original=path.join(f.data,'original.pdf'),backup=path.join(f.data,'backups');fs.mkdirSync(backup);
    fs.copyFileSync(path.join(f.data,'files',f.catalog.papers[0].hash+'.pdf'),original);
    fs.copyFileSync(original,path.join(backup,'saved.pdf'));
    let committed;
    const result=purgeTrashed(f.data,f.catalog,f.request,next=>committed=next);
    assert.equal(result.count,2);assert.equal(committed.papers.length,0);assert.deepEqual(fs.readdirSync(path.join(f.data,'files')),[]);
    assert.equal(fs.existsSync(original),true);assert.equal(fs.existsSync(path.join(backup,'saved.pdf')),true);
    assert.deepEqual(fs.readdirSync(path.join(f.data,'deletions')),[]);
  }finally{fs.rmSync(f.data,{recursive:true,force:true});}
});
test('确认文字、版本或回收站状态不匹配时不删除',()=>{
  const f=fixture();try{
    const commit=()=>assert.fail('must not commit');
    assert.throws(()=>purgeTrashed(f.data,f.catalog,{...f.request,confirmation:'删除'},commit),{status:400});
    assert.throws(()=>purgeTrashed(f.data,f.catalog,{...f.request,items:[...f.request.items.slice(0,1),{id:f.catalog.papers[1].id,expectedRevision:0}]},commit),{status:409});
    f.catalog.papers[1].trashed=false;assert.throws(()=>purgeTrashed(f.data,f.catalog,f.request,commit),{status:409});
    assert.equal(fs.readdirSync(path.join(f.data,'files')).length,2);
  }finally{fs.rmSync(f.data,{recursive:true,force:true});}
});
test('书目保存失败时恢复已移走的 PDF',()=>{
  const f=fixture();try{
    assert.throws(()=>purgeTrashed(f.data,f.catalog,f.request,()=>{throw Error('模拟磁盘错误');}),/模拟磁盘错误/);
    assert.equal(fs.readdirSync(path.join(f.data,'files')).length,2);
    assert.deepEqual(fs.readdirSync(path.join(f.data,'deletions')),[]);
  }finally{fs.rmSync(f.data,{recursive:true,force:true});}
});
test('重启依据书目恢复未提交清除，清理已提交清除',()=>{
  for(const committed of [false,true]){
    const f=fixture();try{
      const stage=path.join(f.data,'deletions',randomUUID());fs.mkdirSync(stage,{recursive:true});
      fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify({format:'paperdesk-purge',hashes:f.catalog.papers.map(p=>p.hash)}));
      for(const p of f.catalog.papers)fs.renameSync(path.join(f.data,'files',p.hash+'.pdf'),path.join(stage,p.hash+'.pdf'));
      recoverDeletions(f.data,committed?{version:1,papers:[]}:f.catalog);
      assert.equal(fs.readdirSync(path.join(f.data,'files')).length,committed?0:2);
      assert.deepEqual(fs.readdirSync(path.join(f.data,'deletions')),[]);
    }finally{fs.rmSync(f.data,{recursive:true,force:true});}
  }
});
