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

test('32 类预设覆盖多学科，关键词参与分类且不误配普通词',()=>{
  assert.equal(DEFAULT_RULES.length,32);validateRules(DEFAULT_RULES);
  const examples=[['自然语言处理','sentiment analysis'],['网络安全与隐私','differential privacy'],['物联网与传感器','传感网络'],['生物学与生物信息','genomics'],['材料科学','纳米材料'],['经济与金融','econometrics'],['教育与心理','psychology'],['统计与研究方法','causal inference']];
  for(const [tag,keywords] of examples)assert.ok(suggestTags(paper({title:'研究结果',filename:'paper.pdf',keywords}),DEFAULT_RULES).some(r=>r.tag===tag),tag);
  assert.deepEqual(suggestTags(paper({title:'ordinary methods and results',filename:'paper.pdf'}),DEFAULT_RULES),[]);
});

test('追加预设保留同名自定义规则，重复追加幂等，超限不部分修改',async()=>{
  const {mergePresetRules,RULE_PRESETS}=await import('../lib/classify.mjs');
  const original=[{tag:'机器学习',keywords:['我自己的关键词']},{tag:'个人专题',keywords:['my project']}],snapshot=structuredClone(original);
  const result=mergePresetRules(original,'全部预设');assert.equal(result.added,31);assert.equal(result.rules.length,33);
  assert.deepEqual(result.rules[0],original[0]);assert.deepEqual(original,snapshot);
  assert.equal(mergePresetRules(result.rules,'全部预设').added,0);
  for(const p of RULE_PRESETS)assert.equal(mergePresetRules([],p.name).rules.length,p.tags.length);
  const full=Array.from({length:40},(_,i)=>({tag:'自定义'+i,keywords:['private topic']}));const before=structuredClone(full);
  assert.throws(()=>mergePresetRules(full,'全部预设'),{status:400});assert.deepEqual(full,before);
  assert.throws(()=>mergePresetRules(original,'不存在的组'),{status:400});
});
