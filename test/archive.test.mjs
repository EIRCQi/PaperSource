import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createBackup,restoreBackup,validateCatalog} from '../lib/archive.mjs';
import {toBibtex} from '../lib/bibtex.mjs';

async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-archive-'));
  const data=path.join(root,'source');await fs.mkdir(path.join(data,'files'),{recursive:true});
  const bytes=Buffer.from('%PDF-1.4\narchive-test\n%%EOF');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const paper={id:randomUUID(),hash,size:bytes.length,filename:'备份论文.pdf',title:'研究结果',authors:'Smith, John；Doe, Jane',year:'2026',journal:'Test',doi:'10.1/example',notes:' 保留笔记\n',tags:['研究'],status:'reading',favorite:true,trashed:false,revision:3,createdAt:new Date().toISOString()};
  await fs.writeFile(path.join(data,'files',hash+'.pdf'),bytes);
  return {root,data,bytes,paper,catalog:{version:1,papers:[paper]}};
}

test('完整备份快照包含 PDF、笔记与回收站，恢复到独立目录',async()=>{
  const f=await fixture();
  try{
    f.paper.trashed=true;
    const pending=createBackup(f.data,f.catalog);
    // A later edit does not change the snapshot being copied.
    f.paper.notes='稍后修改';
    const backup=await pending;
    const target=path.join(f.root,'restored');await restoreBackup(backup.path,target);
    const restored=JSON.parse(await fs.readFile(path.join(target,'catalog.json'),'utf8'));
    assert.equal(restored.papers[0].notes,' 保留笔记\n');assert.equal(restored.papers[0].trashed,true);
    assert.deepEqual(await fs.readFile(path.join(target,'files',f.paper.hash+'.pdf')),f.bytes);
    await assert.rejects(fs.stat(path.join(target,'running.lock')),{code:'ENOENT'});
    await assert.rejects(restoreBackup(backup.path,target),{code:'EEXIST'});
    assert.equal(JSON.parse(await fs.readFile(path.join(target,'catalog.json'),'utf8')).papers.length,1);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('备份失败清理未完成副本，保留源目录',async()=>{
  const f=await fixture();
  try{
    await fs.unlink(path.join(f.data,'files',f.paper.hash+'.pdf'));
    await assert.rejects(createBackup(f.data,f.catalog));
    assert.deepEqual(await fs.readdir(path.join(f.data,'backups')),[]);
    assert.equal((await fs.stat(f.data)).isDirectory(),true);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('损坏的 PDF 或题录不能恢复，不留下半成品目录',async()=>{
  const f=await fixture();
  try{
    const backup=await createBackup(f.data,f.catalog);
    const pdf=path.join(backup.path,'files',f.paper.hash+'.pdf');
    await fs.writeFile(pdf,Buffer.alloc(f.bytes.length,65));
    const target=path.join(f.root,'rejected');
    await assert.rejects(restoreBackup(backup.path,target),/校验失败/);
    await assert.rejects(fs.stat(target),{code:'ENOENT'});
    await fs.writeFile(path.join(backup.path,'catalog.json'),'{}');
    await assert.rejects(restoreBackup(backup.path,target),/题录校验失败/);
    await assert.rejects(fs.stat(target),{code:'ENOENT'});
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('书目路径穿越和非法字段被拒绝',async()=>{
  const f=await fixture();
  try{
    for(const changes of [{hash:'../../outside'},{tags:[{}]},{revision:-1},{size:-1},{title:null}]){
      assert.throws(()=>validateCatalog({version:1,papers:[{...f.paper,...changes}]}));
    }
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('BibTeX 导出区分作者并排除笔记与回收站',async()=>{
  const f=await fixture();
  try{
    f.paper.title='A&B 50% {model} $x_1$ \\ command';
    const result=toBibtex([f.paper,{...f.paper,id:randomUUID(),title:'回收站标题',trashed:true}]);
    assert.match(result,/Smith, John and Doe, Jane/);
    assert.match(result,/A\\&B 50\\%/);
    assert.match(result,/textbraceleft/);
    assert.match(result,/textbackslash/);
    assert.equal(result.includes('回收站标题'),false);
    assert.equal(result.includes(f.paper.notes),false);
    assert.equal((result.match(/@misc/g)||[]).length,1);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
