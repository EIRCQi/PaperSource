import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBatch} from '../lib/batch.mjs';

const fixture=()=>({version:1,papers:[
  {id:'a',revision:2,title:'甲',tags:['原标签'],notes:'原笔记',status:'unread',favorite:false,trashed:false},
  {id:'b',revision:4,title:'乙',tags:['原标签'],notes:'另一篇笔记',status:'reading',favorite:true,trashed:false},
  {id:'c',revision:1,title:'未选择',tags:[],notes:'保留',status:'done',favorite:false,trashed:false},
]});
const items=[{id:'a',expectedRevision:2},{id:'b',expectedRevision:4}];

test('批量整理仅更新所选文献，保留笔记和无关字段',()=>{
  const db=fixture(),before=structuredClone(db);
  const result=applyBatch(db,{items,action:'addTag',value:' 新标签 '});
  assert.deepEqual(db,before);
  assert.equal(result.papers.length,2);
  assert.deepEqual(result.papers[0].tags,['原标签','新标签']);
  assert.equal(result.papers[0].notes,'原笔记');
  assert.equal(result.papers[0].revision,3);
  assert.equal(result.papers[1].revision,5);
  assert.deepEqual(result.catalog.papers[2],before.papers[2]);
});

test('任一版本冲突、缺失或标签超限时整批不变',()=>{
  for(const failure of ['stale','missing','tags']){
    const db=fixture();
    if(failure==='tags')db.papers[1].tags=Array.from({length:50},(_,i)=>'标签'+i);
    const before=structuredClone(db);
    const request={items:structuredClone(items),action:'addTag',value:'新标签'};
    if(failure==='stale')request.items[1].expectedRevision=3;
    if(failure==='missing')request.items[1].id='missing';
    assert.throws(()=>applyBatch(db,request));assert.deepEqual(db,before);
  }
});

test('标签追加去重与移除、阅读状态、星标、回收站恢复',()=>{
  let db=fixture();
  const run=(action,value)=>{
    const current=db.papers.slice(0,2).map(p=>({id:p.id,expectedRevision:p.revision}));
    db=applyBatch(db,{items:current,action,value}).catalog;
  };
  run('addTag','原标签');assert.deepEqual(db.papers[0].tags,['原标签']);
  run('removeTag','原标签');assert.deepEqual(db.papers[0].tags,[]);
  run('status','done');assert.equal(db.papers[1].status,'done');
  run('favorite',false);assert.equal(db.papers[1].favorite,false);
  run('trash');assert.equal(db.papers[0].trashed,true);
  assert.throws(()=>run('addTag','回收站操作'));
  run('restore');assert.equal(db.papers[0].trashed,false);
  assert.equal(db.papers[0].notes,'原笔记');
});

test('批量输入边界：重复 ID、空列表、超限及非法值',()=>{
  const db=fixture();
  const invalid=[
    {items:[],action:'trash'},
    {items:[items[0],items[0]],action:'trash'},
    {items:Array(501).fill(items[0]),action:'trash'},
    {items,action:'delete'},
    {items,action:'status',value:'unknown'},
    {items,action:'favorite',value:'true'},
    {items,action:'addTag',value:'   '},
    {items,action:'addTag',value:'甲，乙'},
    {items,action:'addTag',value:'x'.repeat(81)},
    {items:[{id:'a',expectedRevision:-1}],action:'trash'},
  ];
  for(const request of invalid)assert.throws(()=>applyBatch(db,request),{status:400});
  const big={version:1,papers:Array.from({length:500},(_,i)=>({...db.papers[0],id:String(i)}))};
  const result=applyBatch(big,{items:big.papers.map(p=>({id:p.id,expectedRevision:p.revision})),action:'status',value:'done'});
  assert.equal(result.papers.length,500);
});
