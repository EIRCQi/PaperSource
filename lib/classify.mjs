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
  {tag:'自然语言处理',keywords:['自然语言处理','文本分类','情感分析','机器翻译','natural language processing','text classification','sentiment analysis','machine translation','NLP']},
  {tag:'语音与音频',keywords:['语音识别','语音合成','音频处理','speech recognition','speech synthesis','audio processing']},
  {tag:'强化学习',keywords:['强化学习','策略梯度','reinforcement learning','policy gradient','Q learning']},
  {tag:'机器人与自动驾驶',keywords:['机器人','自动驾驶','robotics','robot navigation','autonomous driving','self driving']},
  {tag:'知识图谱与检索',keywords:['知识图谱','信息检索','检索增强','knowledge graph','information retrieval','retrieval augmented','RAG']},
  {tag:'推荐系统',keywords:['推荐系统','协同过滤','recommender system','recommendation system','collaborative filtering']},
  {tag:'数据挖掘与数据库',keywords:['数据挖掘','数据库','大数据','data mining','database','big data']},
  {tag:'软件工程与程序分析',keywords:['软件工程','程序分析','软件测试','代码生成','software engineering','program analysis','software testing','code generation']},
  {tag:'网络安全与隐私',keywords:['网络安全','隐私保护','差分隐私','联邦学习','cybersecurity','differential privacy','federated learning','intrusion detection']},
  {tag:'云计算与边缘计算',keywords:['云计算','边缘计算','分布式计算','cloud computing','edge computing','distributed computing']},
  {tag:'信号处理',keywords:['信号处理','滤波','波束形成','signal processing','filtering','beamforming']},
  {tag:'物联网与传感器',keywords:['物联网','传感器','传感网络','internet of things','IoT','sensor network','sensors']},
  {tag:'控制与优化',keywords:['控制理论','最优控制','凸优化','多目标优化','control theory','optimal control','convex optimization','multi objective optimization']},
  {tag:'生物学与生物信息',keywords:['生物信息','基因组','蛋白质','bioinformatics','genomics','proteomics','protein']},
  {tag:'神经科学与脑机接口',keywords:['神经科学','脑机接口','脑电','neuroscience','brain computer interface','electroencephalography','EEG']},
  {tag:'药学与药物研发',keywords:['药学','药物研发','药物递送','pharmacology','drug discovery','drug delivery']},
  {tag:'材料科学',keywords:['材料科学','纳米材料','复合材料','materials science','nanomaterial','composite material']},
  {tag:'化学与化工',keywords:['化学','化工','催化','chemistry','chemical engineering','catalysis']},
  {tag:'物理与量子技术',keywords:['物理','量子','光子学','physics','quantum','photonics']},
  {tag:'能源与环境',keywords:['能源','环境科学','气候变化','可再生能源','energy storage','environmental science','climate change','renewable energy']},
  {tag:'地球科学与遥感',keywords:['地球科学','遥感','地理信息','earth science','remote sensing','geographic information','geology']},
  {tag:'经济与金融',keywords:['经济学','金融','经济计量','economics','finance','econometrics','asset pricing']},
  {tag:'教育与心理',keywords:['教育','心理学','学习科学','education','psychology','learning sciences']},
  {tag:'统计与研究方法',keywords:['统计推断','因果推断','贝叶斯','实验设计','statistical inference','causal inference','bayesian','experimental design','meta analysis']},
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

export const RULE_PRESETS=[
  {name:'全部预设',tags:DEFAULT_RULES.map(r=>r.tag)},
  {name:'人工智能与计算机',tags:['机器学习','大语言模型','计算机视觉','自然语言处理','语音与音频','强化学习','机器人与自动驾驶','知识图谱与检索','推荐系统','数据挖掘与数据库','软件工程与程序分析','网络安全与隐私','云计算与边缘计算']},
  {name:'电子通信与工程',tags:['雷达与感知','定位与导航','无线通信','信号处理','物联网与传感器','控制与优化']},
  {name:'医学与生命科学',tags:['医学与健康','生物学与生物信息','神经科学与脑机接口','药学与药物研发']},
  {name:'理工与环境',tags:['材料科学','化学与化工','物理与量子技术','能源与环境','地球科学与遥感']},
  {name:'人文社科与研究方法',tags:['经济与金融','教育与心理','统计与研究方法','综述']},
];
// Explicit opt-in for saved libraries: never replace a user's same-name rule.
export function mergePresetRules(current,presetName){
  const rules=validateRules(current),preset=RULE_PRESETS.find(p=>p.name===presetName);
  if(!preset)reject(400,'请选择有效的预设分类组');
  const existing=new Set(rules.map(r=>r.tag));
  const added=DEFAULT_RULES.filter(r=>preset.tags.includes(r.tag)&&!existing.has(r.tag));
  if(rules.length+added.length>40)reject(400,`补充后共 ${rules.length+added.length} 条，超过 40 条上限。请选择较小的预设组，或先删除不需要的规则。`);
  return {rules:validateRules([...rules,...added]),added:added.length};
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
