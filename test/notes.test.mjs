import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendTemplate,notePages,NOTE_TEMPLATES} from '../public/notes.mjs';

test('笔记模板追加保留原文和换行，拒绝非法模板及超长笔记',()=>{
  const existing='  已整理的研究结论\n[第 2 页]\n';
  for(const key of Object.keys(NOTE_TEMPLATES)){
    assert.equal(appendTemplate(existing,key),existing+'\n\n'+NOTE_TEMPLATES[key].text);
    assert.equal(appendTemplate('',key),NOTE_TEMPLATES[key].text);
  }
  assert.throws(()=>appendTemplate(existing,'toString'),/有效/);
  assert.throws(()=>appendTemplate('文'.repeat(100000),'summary'),/长度/);
});

test('页码引用去重并限制数量，忽略无效值与任意 HTML',()=>{
  assert.deepEqual(notePages('[第 2 页] 引文 [第 1 页] [第 2 页] [第 0 页] [第 -1 页] <script>x</script>'),[2,1]);
  assert.deepEqual(notePages('[第 99999999 页] 普通笔记'),[]);
  assert.equal(notePages(Array.from({length:250},(_,i)=>`[第 ${i+1} 页]`).join('\n')).length,200);
});
