import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findTextMatches} from '../public/reader-search.mjs';

test('页内查找支持大小写、全角和 PDF 连字，保留原文偏移',()=>{
  const text='ＡＢＣ abc oﬃce 😀标题';
  assert.deepEqual(findTextMatches(text,'abc').matches.map(m=>text.slice(m.start,m.end)),['ＡＢＣ','abc']);
  assert.deepEqual(findTextMatches(text,'OFFICE').matches.map(m=>text.slice(m.start,m.end)),['oﬃce']);
  assert.deepEqual(findTextMatches(text,'😀标题').matches.map(m=>text.slice(m.start,m.end)),['😀标题']);
  assert.deepEqual(findTextMatches('ﬃ','f').matches,[{start:0,end:1}]);
});

test('跨换行短语仍可定位，特殊符号按字面匹配，空查询不匹配',()=>{
  const text='local \n\t search [a+b] 中文研究';
  const result=findTextMatches(text,'LOCAL search');
  assert.equal(text.slice(result.matches[0].start,result.matches[0].end),'local \n\t search');
  assert.equal(findTextMatches(text,'[a+b]').matches.length,1);
  assert.equal(findTextMatches(text,'中文').matches.length,1);
  assert.equal(findTextMatches(text,'missing').matches.length,0);
  assert.equal(findTextMatches(text,'  ').matches.length,0);
});

test('查找结果有数量上限，只在确有更多命中时提示截断',()=>{
  assert.equal(findTextMatches('a '.repeat(500),'a').limited,false);
  const result=findTextMatches('a '.repeat(501),'a');assert.equal(result.matches.length,500);assert.equal(result.limited,true);
});
