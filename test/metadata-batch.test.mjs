import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyMetadataBatch,metadataSuggestions} from '../lib/metadata-batch.mjs';
const paper=(id,extra={})=>({id,revision:1,title:'download',filename:'download.pdf',authors:'',keywords:'',year:'',doi:'',journal:'',notes:'保留笔记',tags:['已有标签'],trashed:false,...extra});

test('批量题录仅建议空字段和文件名标题，保留已有内容',()=>{
  const p=paper('a',{authors:'手工作者',keywords:'自有关键词'});
  assert.deepEqual(metadataSuggestions(p,{title:'真实标题',authors:'候选作者',keywords:'候选词',doi:'10.1234/example',notes:'不应写入'}),{title:'真实标题',doi:'10.1234/example'});
  assert.deepEqual(metadataSuggestions({...p,title:'自定义标题'},{title:'真实标题'}),{});
  assert.deepEqual(metadataSuggestions({...p,trashed:true},{doi:'10.1234/example'}),{});
});
test('批量题录一次补全，保留笔记标签，失败时不部分改写',()=>{
  const db={version:1,papers:[paper('a'),paper('b')]},before=structuredClone(db);
  const items=db.papers.map(p=>({id:p.id,expectedRevision:1,fields:{authors:'张三; 李四',keywords:'深度学习'}}));
  const updated=applyMetadataBatch(db,{items});assert.deepEqual(db,before);
  for(const p of updated.papers){assert.equal(p.authors,'张三; 李四');assert.equal(p.revision,2);assert.equal(p.notes,'保留笔记');assert.deepEqual(p.tags,['已有标签']);}
  assert.throws(()=>applyMetadataBatch(db,{items:[items[0],{...items[1],expectedRevision:0}]}),{status:409});assert.deepEqual(db,before);
  assert.throws(()=>applyMetadataBatch({...db,papers:[db.papers[0],{...db.papers[1],authors:'手工作者'}]},{items}),{status:409});
  assert.throws(()=>applyMetadataBatch({...db,papers:[db.papers[0],{...db.papers[1],trashed:true}]},{items}),{status:409});
});
test('拒绝越权字段、重复选择、空值和超限批次',()=>{
  const db={version:1,papers:[paper('a')]};const item={id:'a',expectedRevision:1,fields:{authors:'Author'}};
  for(const fields of [{notes:'覆盖笔记'},{tags:[]},{authors:[]},{authors:' '},{authors:'x'.repeat(2001)},{},[]])assert.throws(()=>applyMetadataBatch(db,{items:[{...item,fields}]}),{status:400});
  assert.throws(()=>applyMetadataBatch(db,{items:[item,item]}),{status:400});
  assert.throws(()=>applyMetadataBatch(db,{items:Array(101).fill(item)}),{status:400});
  assert.throws(()=>applyMetadataBatch(db,{items:[]}),{status:400});
});
