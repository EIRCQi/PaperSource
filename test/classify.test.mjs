import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRules,suggestTags,previewClassification,applyClassification,DEFAULT_RULES} from '../lib/classify.mjs';
const paper=(changes={})=>({id:'paper',revision:1,title:'UWB indoor localization survey',filename:'deep-learning.pdf',journal:'',tags:['手动标签'],notes:'原笔记',trashed:false,...changes});

test('自动分类支持中英文、文件名分隔符、多标签与解释',()=>{
  const p=paper();const suggestions=suggestTags(p,DEFAULT_RULES);
  assert.deepEqual(suggestions.map(s=>s.tag),['机器学习','定位与导航','综述']);
  assert.ok(suggestions.find(s=>s.tag==='定位与导航').keywords.includes('UWB'));
  assert.equal(suggestTags(paper({title:'临床医学综述',filename:'a.pdf'}),DEFAULT_RULES).some(s=>s.tag==='医学与健康'),true);
  assert.equal(suggestTags(paper({title:'chair training',filename:'a.pdf'}),[{tag:'AI',keywords:['AI']}]).length,0);
  assert.equal(suggestTags(paper({title:'方法',filename:'a.pdf',notes:'UWB'}),DEFAULT_RULES).length,0);
  assert.equal(suggestTags(paper({trashed:true}),DEFAULT_RULES).length,0);
});

test('分类预览不修改数据，应用保留手动标签与笔记',()=>{
  const catalog={version:1,papers:[paper()]};const original=structuredClone(catalog);
  const rules=[{tag:'定位',keywords:['UWB','定位']}];
  const preview=previewClassification(catalog,rules);assert.equal(preview.length,1);assert.deepEqual(catalog,original);
  const result=applyClassification(catalog,{items:preview,rules,expectedSettingsRevision:0,autoOnImport:true});
  assert.deepEqual(result.papers[0].tags,['手动标签','定位']);assert.equal(result.papers[0].notes,'原笔记');
  assert.equal(result.catalog.classification.revision,1);assert.equal(result.papers[0].revision,2);
  assert.equal(previewClassification(result.catalog,rules).length,0);assert.deepEqual(catalog,original);
});

test('分类规则和文献冲突不部分应用',()=>{
  const catalog={version:1,papers:[paper(),paper({id:'other',revision:2})]};const original=structuredClone(catalog);
  const request={items:[{id:'paper',expectedRevision:1},{id:'other',expectedRevision:1}],rules:DEFAULT_RULES,expectedSettingsRevision:0,autoOnImport:false};
  assert.throws(()=>applyClassification(catalog,request),{status:409});assert.deepEqual(catalog,original);
  assert.throws(()=>applyClassification(catalog,{...request,items:[],expectedSettingsRevision:99}),{status:409});
  const saved=applyClassification(catalog,{...request,items:[]});assert.equal(saved.papers.length,0);assert.equal(saved.catalog.classification.autoOnImport,false);
  for(const rules of [null,[{tag:'重复',keywords:['a']},{tag:'重复',keywords:['b']}],[{tag:'x',keywords:[]}],[{tag:'x',keywords:['a,b']}],Array(41).fill({tag:'x',keywords:['a']})])assert.throws(()=>validateRules(rules),{status:400});
});
