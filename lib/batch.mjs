const reject=(status,message)=>{throw Object.assign(new Error(message),{status});};

// Validate every record before returning a new snapshot. The caller commits once.
export function applyBatch(catalog,request) {
  if(!request||!Array.isArray(request.items)||request.items.length<1||request.items.length>500) reject(400,'每次请选择 1 至 500 篇文献');
  const {action,value}=request;
  if(!['status','favorite','trash','restore','addTag','removeTag'].includes(action)) reject(400,'批量操作无效');
  if(action==='status'&&!['unread','reading','done'].includes(value)) reject(400,'阅读状态无效');
  if(action==='favorite'&&typeof value!=='boolean') reject(400,'星标状态无效');
  let tag;
  if(['addTag','removeTag'].includes(action)){
    if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[,，]/.test(value)) reject(400,'请输入一个标签，最多 80 字，不含逗号');
    tag=value.trim();
  }
  const byId=new Map(catalog.papers.map(p=>[p.id,p]));
  const changes=new Map();
  const now=new Date().toISOString();
  for(const item of request.items){
    if(!item||typeof item.id!=='string'||!Number.isSafeInteger(item.expectedRevision)||item.expectedRevision<0) reject(400,'文献版本或标识无效');
    if(changes.has(item.id)) reject(400,'不能重复选择同一篇文献');
    const paper=byId.get(item.id);
    if(!paper) reject(409,'所选文献不存在，本次操作未修改任何文献，请刷新列表重新选择');
    if((paper.revision||0)!==item.expectedRevision) reject(409,'所选文献已被修改，本次操作未修改任何文献，请刷新列表重新选择');
    if(paper.trashed&&action!=='restore') reject(400,'回收站文献请先恢复，再进行其他整理');
    const next={...paper};
    if(action==='status')next.status=value;
    if(action==='favorite')next.favorite=value;
    if(action==='trash')next.trashed=true;
    if(action==='restore')next.trashed=false;
    if(action==='addTag'){
      next.tags=[...new Set([...paper.tags,tag])];
      if(next.tags.length>50)reject(400,'部分文献将超过 50 个标签，本次操作未修改任何文献');
    }
    if(action==='removeTag')next.tags=paper.tags.filter(t=>t!==tag);
    next.revision=(paper.revision||0)+1;
    next.updatedAt=now;
    changes.set(item.id,next);
  }
  return {catalog:{...catalog,papers:catalog.papers.map(p=>changes.get(p.id)||p)},papers:[...changes.values()]};
}
