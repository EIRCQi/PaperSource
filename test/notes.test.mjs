import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendTemplate,notePages,NOTE_TEMPLATES,appendExcerpt,notesMarkdown,notesFilename} from '../public/notes.mjs';

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

test('原文摘录在笔记末尾追加带页码的引用，保持原文和已有笔记',()=>{
  const existing='  我的笔记\n';
  assert.equal(appendExcerpt(existing,'第一行\r\n第二行',3),existing+'\n\n[第 3 页]\n> 第一行\n> 第二行\n');
  assert.equal(appendExcerpt('','<script>text</script>',1),'[第 1 页]\n> <script>text</script>\n');
  for(const page of [0,-1,1.5,'2'])assert.throws(()=>appendExcerpt(existing,'文字',page));
  assert.throws(()=>appendExcerpt(existing,' ',1));
  assert.throws(()=>appendExcerpt(existing,'字'.repeat(10001),1),/10000/);
  assert.throws(()=>appendExcerpt('字'.repeat(99999),'abc',1),/长度/);
});

test('笔记导出保留 Markdown 正文、明确草稿状态，元数据不能注入标题',()=>{
  const paper={title:'# 标题\n<script>',authors:'Alice [x](url)',doi:'10.1/test',tags:['分类']};
  const note='## 我的结论\n\n[第 3 页]\n> 一段原文\n';
  const output=notesMarkdown(paper,note,{draft:true});
  assert.match(output,/导出包含当前未保存编辑/);
  assert.ok(output.endsWith(note+'\n'));
  assert.ok(output.startsWith('# \\# 标题 \\<script\\>\n'));
  assert.ok(output.includes('Alice \\[x\\]\\(url\\)'));
  assert.ok(!notesMarkdown(paper,note).includes('未保存编辑'));
});

test('导出文件名可用于 Windows 与 Mac，不包含路径和控制字符',()=>{
  for(const name of ['../bad\\name:*?<>|\u0000','', 'CON', '标题'.repeat(100)]){
    const file=notesFilename(name);assert.ok(file.endsWith('-阅读笔记.md'));assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(file));assert.ok(file.length<=90);
  }
});
