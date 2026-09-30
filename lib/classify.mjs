const reject=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const DEFAULT_RULES=[
  {tag:'机器学习',keywords:['机器学习','深度学习','神经网络','machine learning','deep learning','neural network','transformer']},
  {tag:'大语言模型',keywords:['大语言模型','语言模型','large language model','LLM','GPT']},
  {tag:'计算机视觉',keywords:['计算机视觉','图像识别','目标检测','computer vision','object detection','image segmentation']},
  {tag:'雷达与感知',keywords:['雷达','感知','radar','sensing','activity recognition']},
  {tag:'定位与导航',keywords:['定位','导航','localization','positioning','navigation','UWB']},
  {tag:'无线通信',keywords:['无线通信','wireless','MIMO','OFDM','5G','6G']},
  {tag:'医学与健康',keywords:['医学','医疗','健康','medical','clinical','healthcare']},
  {tag:'综述',keywords:['综述','survey','systematic review','literature review']},
];
export function validateRules(rules){
  if(!Array.isArray(rules)||rules.length>40)reject(400,'最多设置 40 条分类规则');
  const seen=new Set();
  return rules.map(rule=>{
    if(!rule||typeof rule.tag!=='string'||!rule.tag.trim()||rule.tag.trim().length>80||/[,，=＝]/.test(rule.tag))reject(400,'分类名称不能为空、超过 80 字或包含逗号、等号');
    const tag=rule.tag.trim();if(seen.has(tag))reject(400,'分类名称重复：'+tag);seen.add(tag);
    if(!Array.isArray(rule.keywords)||rule.keywords.length<1||rule.keywords.length>30)reject(400,'每条规则需要 1 至 30 个关键词');
    if(rule.keywords.some(k=>typeof k!=='string'||!k.trim()||k.trim().length>80||/[,，\r\n]/.test(k)))reject(400,'关键词不能为空、超过 80 字或包含逗号、换行');
    return {tag,keywords:[...new Set(rule.keywords.map(k=>k.trim()))]};
  });
}
export function settings(catalog){return catalog.classification||{revision:0,rules:DEFAULT_RULES,autoOnImport:true};}
const normalize=text=>text.normalize('NFKC').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const compiledRules=new WeakMap();
function compile(rules){
  if(compiledRules.has(rules))return compiledRules.get(rules);
  const compiled=rules.map(rule=>({tag:rule.tag,keywords:rule.keywords.map(keyword=>{
    const k=normalize(keyword);
    return {keyword,normalized:k,pattern:/^[a-z0-9 ]+$/.test(k)?new RegExp('(^|[^a-z0-9])'+k+'(?=$|[^a-z0-9])'):null};
  })}));
  compiledRules.set(rules,compiled);return compiled;
}
export function suggestTags(paper,rules){
  if(paper.trashed)return [];
  const text=normalize([paper.title,paper.filename,paper.journal,paper.keywords].join(' '));
  return compile(rules).flatMap(rule=>{
    if(paper.tags.includes(rule.tag))return [];
    const hits=rule.keywords.filter(k=>k.pattern?k.pattern.test(text):text.includes(k.normalized)).map(k=>k.keyword);
    return hits.length?[{tag:rule.tag,keywords:hits}]:[];
  });
}
export function previewClassification(catalog,rules){
  rules=validateRules(rules);
  return catalog.papers.flatMap(p=>{
    const matches=suggestTags(p,rules);
    return matches.length?[{id:p.id,title:p.title,expectedRevision:p.revision||0,matches}]:[];
  });
}
export function applyClassification(catalog,request){
  if(!request||!Array.isArray(request.items)||request.items.length>500)reject(400,'每次最多确认 500 篇分类建议');
  const rules=validateRules(request.rules);
  if(typeof request.autoOnImport!=='boolean')reject(400,'自动分类开关无效');
  const current=settings(catalog);
  if(request.expectedSettingsRevision!==current.revision)reject(409,'规则已在其他页面更新，请重新打开自动分类');
  const changed=new Map(),byId=new Map(catalog.papers.map(p=>[p.id,p]));
  for(const item of request.items){
    if(!item||typeof item.id!=='string'||!Number.isSafeInteger(item.expectedRevision)||changed.has(item.id))reject(400,'分类选择无效或重复');
    const p=byId.get(item.id);
    if(!p||p.trashed||(p.revision||0)!==item.expectedRevision)reject(409,'文献已变化，请重新预览；本次未修改任何内容');
    const tags=[...p.tags,...suggestTags(p,rules).map(m=>m.tag)];
    if(tags.length>50)reject(400,'部分文献分类后超过 50 个标签，请减少规则或先整理标签');
    changed.set(p.id,{...p,tags,revision:(p.revision||0)+1,updatedAt:new Date().toISOString()});
  }
  return {catalog:{...catalog,classification:{rules,autoOnImport:request.autoOnImport,revision:current.revision+1},papers:catalog.papers.map(p=>changed.get(p.id)||p)},papers:[...changed.values()]};
}
