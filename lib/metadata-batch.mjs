export const METADATA_FIELDS={title:'标题',authors:'作者',keywords:'关键词',doi:'DOI',year:'发表年份',journal:'期刊 / 会议'};
export const METADATA_BATCH_LIMIT=100;
const reject=(status,message)=>{throw Object.assign(new Error(message),{status});};
const filenameTitle=p=>(p.filename||'').replace(/\.pdf$/i,'').trim()||'未命名文献';
function canFill(p,key){return !String(p[key]||'').trim()||(key==='title'&&p.title===filenameTitle(p));}
export function metadataSuggestions(paper,fields){
  if(paper.trashed)return {};
  return Object.fromEntries(Object.keys(METADATA_FIELDS).filter(key=>typeof fields?.[key]==='string'&&fields[key].trim()&&fields[key].length<=2000&&canFill(paper,key)&&fields[key].trim()!==paper[key]).map(key=>[key,fields[key].trim()]));
}
// All versions and fill-only constraints are checked before a single catalog commit.
export function applyMetadataBatch(catalog,request){
  const items=request?.items;
  if(!Array.isArray(items)||items.length<1||items.length>METADATA_BATCH_LIMIT)reject(400,'每次请选择 1 至 100 篇文献补全题录');
  const byId=new Map(catalog.papers.map(p=>[p.id,p])),changed=new Map();
  for(const item of items){
    if(!item||typeof item.id!=='string'||!Number.isSafeInteger(item.expectedRevision)||item.expectedRevision<0||changed.has(item.id))reject(400,'题录选择无效或重复');
    const paper=byId.get(item.id);
    if(!paper||paper.trashed||(paper.revision||0)!==item.expectedRevision)reject(409,'文献已变化，请关闭窗口刷新后重新识别；本次未修改任何文献');
    const fields=item.fields;
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length)reject(400,'请选择要补全的题录字段');
    for(const [key,value] of Object.entries(fields)){
      if(!Object.hasOwn(METADATA_FIELDS,key)||typeof value!=='string'||!value.trim()||value.length>2000)reject(400,'题录字段无效或过长');
      if(!canFill(paper,key))reject(409,'批量识别只补全空字段，不覆盖已有题录；本次未修改任何文献');
    }
    const additions=metadataSuggestions(paper,fields);
    if(!Object.keys(additions).length)reject(400,'所选字段没有需要补全的内容');
    changed.set(paper.id,{...paper,...additions,revision:(paper.revision||0)+1,updatedAt:new Date().toISOString(),metadata:{status:'recognized',message:'已批量补全部分题录，请核对。'}});
  }
  return {catalog:{...catalog,papers:catalog.papers.map(p=>changed.get(p.id)||p)},papers:[...changed.values()]};
}
