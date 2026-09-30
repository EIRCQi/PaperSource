import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractMetadata,inferMetadata,textLines} from '../lib/metadata.mjs';
import {samplePdf} from '../fixtures/pdf.mjs';

test('真实压缩 PDF 提取中文内嵌题录、关键词、DOI，保留原字节',async()=>{
  const bytes=samplePdf({info:{Title:'本地文献管理研究',Author:'张三; 李四',Keywords:'检索; 文献管理; 检索'}}),original=Buffer.from(bytes);
  const result=await extractMetadata(bytes);
  assert.equal(result.status,'recognized');assert.equal(result.fields.title,'本地文献管理研究');
  assert.equal(result.fields.authors,'张三; 李四');assert.equal(result.fields.keywords,'检索; 文献管理');
  assert.equal(result.fields.doi,'10.1234/example.2025');assert.equal(result.fields.year,'2025');
  assert.deepEqual(bytes,original);
});
test('无内嵌题录时识别首页标题、作者与关键词，跳过单位',async()=>{
  const result=await extractMetadata(samplePdf());
  assert.equal(result.fields.title,'Local Research Methods');assert.equal(result.fields.authors,'Alice Chen; Bob Li');
  assert.equal(result.fields.keywords,'deep learning; local search');
  assert.match(result.sources.title,/候选/);
});
test('中文首页与 XMP 数组解析，不把文件创建年份当发表年份',()=>{
  const pages=[[{text:'中文论文标题研究',size:20},{text:'张三，李四',size:12},{text:'某某大学',size:10},{text:'摘要',size:10},{text:'关于资料管理的研究。',size:10},{text:'关键词：机器学习；资料管理。',size:10}]];
  const result=inferMetadata({info:{Title:'Microsoft Word - draft.docx',Author:'Unknown',CreationDate:'D:20260930'},pages});
  assert.equal(result.fields.title,'中文论文标题研究');assert.equal(result.fields.authors,'张三; 李四');
  assert.equal(result.fields.keywords,'机器学习; 资料管理');assert.equal(result.fields.year,undefined);
  const xmp=inferMetadata({xmp:{'dc:title':'XMP Title','dc:creator':['Alice Chen','Bob Li'],'dc:subject':['science','science','data'],'prism:publicationdate':'2024-05-01','prism:publicationname':'Journal of Testing'}});
  assert.equal(xmp.fields.authors,'Alice Chen; Bob Li');assert.equal(xmp.fields.keywords,'science; data');assert.equal(xmp.fields.year,'2024');assert.equal(xmp.fields.journal,'Journal of Testing');
});
test('空白 PDF、损坏 PDF 和识别超时给出明确状态，后续识别仍可用',async()=>{
  assert.equal((await extractMetadata(samplePdf({lines:[]}))).status,'no-text');
  assert.equal((await extractMetadata(Buffer.from('%PDF-1.4\nbroken'))).status,'failed');
  assert.equal((await extractMetadata(samplePdf(),{timeoutMs:1})).status,'timeout');
  assert.equal((await extractMetadata(samplePdf())).status,'recognized');
});
test('分行保留标题字号和中英文词间距',()=>{
  const result=textLines([
    {str:'Local',transform:[20,0,0,20,50,700],width:45},
    {str:'Research',transform:[20,0,0,20,103,700],width:80,hasEOL:true},
    {str:'关键词',transform:[10,0,0,10,50,660],width:30},
    {str:'：学习',transform:[10,0,0,10,80,660],width:30},
  ]);
  assert.deepEqual(result.map(l=>l.text),['Local Research','关键词:学习']);assert.equal(result[0].size,20);
});
