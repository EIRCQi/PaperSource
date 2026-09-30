const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name="app-token"]').content;
const labels={all:'全部文献',favorite:'星标收藏',unread:'待阅读',reading:'阅读中',done:'已读完',trash:'回收站',tag:'标签分类',recent:'本次新增'};
const states={unread:'待阅读',reading:'阅读中',done:'已读完'};
let papers=[],view='all',tag='',selected=null,dirty=false,importing=false,saving=false,backingUp=false;
let page=1,stopImport=false,draftPrefix='',draftWarning=false;
const PAGE_SIZE=50;
const searchIndex=new Map();
const picked=new Map();
let visiblePage=[],lastImported=[],dataGeneration=0,filtering=false;
function renderBulk(){
  const count=picked.size;
  $('selectionCount').textContent=`已选 ${count} 篇`;
  $('clearSelection').disabled=saving||count===0;
  $('openBatch').disabled=saving||importing||filtering||count===0;
  $('selectPage').disabled=saving||importing||filtering||visiblePage.length===0;
  document.querySelectorAll('[data-pick]').forEach(input=>input.disabled=saving||importing||filtering);
  const selectedOnPage=visiblePage.filter(p=>picked.has(p.id)).length;
  $('selectPage').checked=visiblePage.length>0&&selectedOnPage===visiblePage.length;
  $('selectPage').indeterminate=selectedOnPage>0&&selectedOnPage<visiblePage.length;
}
function clearSelection(){picked.clear();}
function editorEnabled(enabled){const form=$('edit');if(form)for(const element of form.elements)element.disabled=!enabled;}
function batchFields(){
  const action=$('batchAction').value;
  $('batchStatusRow').hidden=action!=='status';
  $('batchTagRow').hidden=!['addTag','removeTag'].includes(action);
  $('batchFavoriteRow').hidden=action!=='favorite';
  $('batchTag').required=['addTag','removeTag'].includes(action);
  $('batchHint').textContent=action==='trash'?'选中文献将移入回收站，可以恢复；PDF 不会删除。':'只修改选中的文献；有版本冲突时整批不修改。';
}
function rebuildIndex(){
  searchIndex.clear();
  for(const p of papers)searchIndex.set(p.id,[p.title,p.authors,p.year,p.doi,p.journal,p.notes,...p.tags].join(' ').normalize('NFKC').toLocaleLowerCase());
}
function readDraft(id){try{return JSON.parse(sessionStorage.getItem(draftPrefix+id)||'null');}catch{return null;}}
function deleteDraft(id){try{sessionStorage.removeItem(draftPrefix+id);}catch{}}
function formValues(form){
  const data=new FormData(form),changes=Object.fromEntries(data);
  changes.favorite=data.has('favorite');
  changes.tags=data.get('tags').split(/[,，]/).map(t=>t.trim()).filter(Boolean);
  return changes;
}
function storeDraft(id,revision,form){
  try{sessionStorage.setItem(draftPrefix+id,JSON.stringify({revision,values:formValues(form)}));return true;}
  catch{if(!draftWarning){toast('浏览器无法暂存草稿，请及时点击保存修改。');draftWarning=true;}return false;}
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'X-PaperDesk-Token':token,...options.headers}});const result=await r.json();if(!r.ok)throw Object.assign(new Error(result.error||'操作失败'),{status:r.status});return result;}
async function load(){const generation=dataGeneration;const data=await api('/api/papers');if(generation!==dataGeneration)return load();papers=data.papers;clearSelection();draftPrefix='paperdesk-draft:'+data.dataPath+':';rebuildIndex();$('dataPath').textContent=data.dataPath;renderList();}
function canLeave(){return !dirty||confirm('有尚未保存的修改，确定放弃这些修改吗？');}
function renderList(){
  const live=papers.filter(p=>!p.trashed);$('total').textContent=live.length;
  const tagCounts=new Map();for(const p of live)for(const t of p.tags)tagCounts.set(t,(tagCounts.get(t)||0)+1);
  const tags=[...tagCounts.keys()].sort((a,b)=>a.localeCompare(b,'zh'));
  $('tags').innerHTML=tags.length?tags.map(t=>`<button class="tag-nav ${view==='tag'&&tag===t?'active':''}" data-tag="${esc(t)}"># ${esc(t)} <small>${tagCounts.get(t)}</small></button>`).join(''):'<p class="muted">在文献详情中添加标签</p>';
  const q=$('search').value.trim().normalize('NFKC').toLocaleLowerCase();
  const terms=q.split(/\s+/).filter(Boolean);
  const recentIds=new Set(lastImported);
  let shown=papers.filter(p=>view==='trash'?p.trashed:!p.trashed).filter(p=>view==='recent'?recentIds.has(p.id):view==='favorite'?p.favorite:view==='tag'?p.tags.includes(tag):states[view]?p.status===view:true).filter(p=>terms.every(term=>searchIndex.get(p.id)?.includes(term)));
  const eligible=new Set(shown.map(p=>p.id));for(const id of picked.keys())if(!eligible.has(id))picked.delete(id);
  shown.sort((a,b)=>$('sort').value==='title'?a.title.localeCompare(b.title,'zh'):$('sort').value==='year'?String(b.year).localeCompare(String(a.year)):b.createdAt.localeCompare(a.createdAt));
  $('heading').textContent=view==='tag'?'# '+tag:labels[view];$('summary').textContent=`${shown.length} 篇文献 · ${live.filter(p=>p.status==='done').length} 篇已读完`;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const pageCount=Math.max(1,Math.ceil(shown.length/PAGE_SIZE));page=Math.min(page,pageCount);
  $('pageInfo').textContent=`第 ${page} / ${pageCount} 页`; $('prevPage').disabled=page===1;$('nextPage').disabled=page===pageCount;$('pagination').hidden=shown.length<=PAGE_SIZE;
  visiblePage=shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  $('list').innerHTML=shown.length?visiblePage.map(p=>`<article class="paper-row"><label class="paper-pick"><input type="checkbox" data-pick="${p.id}" aria-label="选择 ${esc(p.title)}" ${picked.has(p.id)?'checked':''} ${saving?'disabled':''}></label><button class="paper ${selected===p.id?'selected':''}" data-id="${p.id}"><div class="paper-top"><span class="pdf">PDF</span><span>${esc(p.year)||'年份待补充'} ${p.favorite?'★':''}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.authors)||'作者待补充'}</p><div class="paper-bottom"><span class="status ${p.status}">${states[p.status]}</span><span>${p.tags.slice(0,2).map(t=>'# '+esc(t)).join('　')}</span></div></button></article>`).join(''):`<div class="empty"><h3>${q?'没有找到匹配文献':view==='all'?'文献库还是空的':'这里还没有文献'}</h3><p>${q?'试试其他关键词。':'导入 PDF，或调整分类与阅读状态。'}</p></div>`;
  renderBulk();
}
function field(key,label,value,placeholder=''){return `<label>${label}<input name="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${key==='title'?'required':''} maxlength="2000"></label>`;}
function renderDetail(){
  let p=papers.find(p=>p.id===selected);if(!p)return;
  let editRevision=p.revision||0;
  dirty=false;
  const pdf=`/api/papers/${p.id}/file?token=${token}`;
  $('detail').innerHTML=`<div class="detail-head"><span>文献详情</span><div>${p.trashed?'':`<a href="/api/export.bib?id=${p.id}&token=${token}" download>导出 BibTeX</a>　`}<a href="${pdf}" target="_blank" rel="noopener">打开 PDF ↗</a></div></div><form id="edit"><div class="form-title">${field('title','文献标题',p.title)}</div><div class="grid">${field('authors','作者',p.authors,'多位作者用分号分隔')}${field('year','发表年份',p.year,'例如：2026')}${field('journal','期刊 / 会议',p.journal)}${field('doi','DOI',p.doi)}</div>${field('tags','标签',p.tags.join('，'),'用逗号分隔，例如：机器学习，待读综述')}<div class="status-row"><label>阅读状态<select name="status">${Object.entries(states).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="checkbox"><input type="checkbox" name="favorite" ${p.favorite?'checked':''}> 星标收藏</label></div><label>阅读笔记<textarea name="notes" rows="6" maxlength="100000" placeholder="研究问题、主要结论，以及你的思考…">${esc(p.notes)}</textarea></label><div class="save-row"><button class="primary" type="submit" id="save">保存修改</button><span id="saveState">已保存</span><button type="button" id="reloadDetail">重新载入</button><button class="subtle" id="trash" type="button">${p.trashed?'恢复文献':'移入回收站'}</button></div></form><details class="preview"><summary>展开 PDF 预览</summary><iframe title="PDF 文献预览" data-src="${pdf}"></iframe></details><p class="file-meta">${esc(p.filename)} · ${(p.size/1024/1024).toFixed(2)} MB · ${new Date(p.createdAt).toLocaleDateString('zh-CN')} 导入</p>`;
  const form=$('edit');
  const draft=readDraft(p.id);
  if(draft&&draft.values&&Number.isSafeInteger(draft.revision)){
    for(const [key,value] of Object.entries(draft.values)){
      const field=form.elements.namedItem(key);if(!field)continue;
      if(key==='favorite')field.checked=value===true;
      else field.value=key==='tags'&&Array.isArray(value)?value.join('，'):String(value);
    }
    editRevision=draft.revision;dirty=true;
    $('saveState').textContent=editRevision===(p.revision||0)?'已恢复未保存草稿':'草稿基于旧版本，请核对后重新载入';
  }
  form.addEventListener('input',()=>{
    dirty=true;const stored=storeDraft(p.id,editRevision,form);$('saveState').textContent=stored?'未保存 · 草稿已暂存':'未保存 · 请及时保存';
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(saving)return;saving=true;
    const changes={...formValues(form),expectedRevision:editRevision};
    const controls=[...form.elements];controls.forEach(c=>c.disabled=true);
    try{
      const updated=await api('/api/papers/'+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
      dataGeneration++;papers=papers.map(x=>x.id===p.id?updated:x);p=updated;editRevision=updated.revision;if(picked.has(p.id))picked.set(p.id,updated.revision);
      deleteDraft(p.id);dirty=false;$('saveState').textContent='已保存';rebuildIndex();renderList();toast('修改已保存');
    }catch(e){$('saveState').textContent=e.message;toast(e.message);}
    finally{controls.forEach(c=>c.disabled=false);saving=false;renderBulk();}
  });
  $('reloadDetail').onclick=async()=>{
    if(saving||!canLeave())return;
    saving=true;const controls=[...form.elements];controls.forEach(c=>c.disabled=true);
    try{await load();deleteDraft(p.id);renderDetail();toast('已载入最新版本');}catch(e){toast(e.message);}
    finally{saving=false;controls.forEach(c=>c.disabled=false);renderBulk();}
  };
  $('trash').onclick=async()=>{
    if(saving||!canLeave())return;
    saving=true;const controls=[...form.elements];controls.forEach(c=>c.disabled=true);
    try{
      const updated=await api('/api/papers/'+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:!p.trashed,expectedRevision:editRevision})});
      dataGeneration++;papers=papers.map(x=>x.id===p.id?updated:x);picked.delete(p.id);deleteDraft(p.id);rebuildIndex();renderList();renderDetail();toast(p.trashed?'文献已恢复':'已移入回收站，可随时恢复');
    }catch(e){toast(e.message);}
    finally{saving=false;controls.forEach(c=>c.disabled=false);renderBulk();}
  };
  document.querySelector('.preview').addEventListener('toggle',e=>{const frame=e.target.querySelector('iframe');if(e.target.open&&!frame.src)frame.src=frame.dataset.src;});
}
$('list').onclick=e=>{const b=e.target.closest('[data-id]');if(!b||saving||!canLeave())return;if(dirty&&selected)deleteDraft(selected);selected=b.dataset.id;renderList();renderDetail();};
$('list').onchange=e=>{
  const id=e.target.dataset.pick;if(!id)return;
  if(saving||importing||filtering){e.target.checked=picked.has(id);return;}
  if(e.target.checked){
    if(picked.size>=500){e.target.checked=false;toast('每次最多选择 500 篇文献');return;}
    const p=papers.find(p=>p.id===id);if(p)picked.set(id,p.revision||0);
  }else picked.delete(id);
  renderBulk();
};
$('selectPage').onchange=e=>{
  if(saving||importing||filtering)return;
  if(e.target.checked){
    const needed=visiblePage.filter(p=>!picked.has(p.id)).length;
    if(picked.size+needed>500){toast('每次最多选择 500 篇文献');renderBulk();return;}
    for(const p of visiblePage)if(!picked.has(p.id))picked.set(p.id,p.revision||0);
  }else for(const p of visiblePage)picked.delete(p.id);
  renderList();
};
$('clearSelection').onclick=()=>{if(saving)return;clearSelection();renderList();};
$('openBatch').onclick=()=>{
  if(saving||importing||filtering||!picked.size)return;
  if(dirty){toast('请先保存当前编辑，再进行批量操作');return;}
  const chosen=papers.filter(p=>picked.has(p.id));
  $('batchSummary').textContent=`本次将处理 ${chosen.length} 篇文献：${chosen.slice(0,3).map(p=>p.title).join('、')}${chosen.length>3?'…':''}`;
  const inTrash=chosen.every(p=>p.trashed);
  for(const option of $('batchAction').options)option.disabled=inTrash?option.value!=='restore':option.value==='restore';
  $('batchAction').value=inTrash?'restore':'status';
  $('batchError').hidden=true;batchFields();$('batchDialog').showModal();
};
$('batchAction').onchange=batchFields;
$('cancelBatch').onclick=()=>{if(!saving)$('batchDialog').close();};
$('batchDialog').addEventListener('cancel',e=>{if(saving)e.preventDefault();});
$('batchForm').onsubmit=async e=>{
  e.preventDefault();if(saving||importing||filtering||!picked.size)return;
  const action=$('batchAction').value;
  const value=action==='status'?$('batchStatus').value:action==='favorite'?$('batchFavorite').value==='yes':$('batchTag').value.trim();
  const items=[...picked].map(([id,expectedRevision])=>({id,expectedRevision}));
  saving=true;editorEnabled(false);const controls=[...$('batchForm').elements];controls.forEach(c=>c.disabled=true);$('batchError').hidden=true;renderBulk();
  try{
    const result=await api('/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,action,value})});
    dataGeneration++;const changed=new Map(result.papers.map(p=>[p.id,p]));papers=papers.map(p=>changed.get(p.id)||p);
    clearSelection();rebuildIndex();if(changed.has(selected))renderDetail();$('batchDialog').close();toast(`已更新 ${result.count} 篇文献`);
  }catch(error){$('batchError').textContent=error.message;$('batchError').hidden=false;}
  finally{saving=false;controls.forEach(c=>c.disabled=false);editorEnabled(true);renderList();}
};
$('refresh').onclick=async()=>{
  if(saving||importing){toast('请等待当前操作完成');return;}
  if(dirty){toast('请先保存当前编辑，再刷新列表');return;}
  saving=true;$('refresh').disabled=true;editorEnabled(false);
  try{await load();if(selected)renderDetail();toast('列表已刷新，批量选择已清空');}catch(error){toast(error.message);}
  finally{saving=false;$('refresh').disabled=false;editorEnabled(true);renderList();}
};
$('nav').onclick=e=>{const b=e.target.closest('[data-view]');if(!b||saving)return;clearSelection();view=b.dataset.view;page=1;renderList();};
$('tags').onclick=e=>{const b=e.target.closest('[data-tag]');if(!b||saving)return;clearSelection();view='tag';tag=b.dataset.tag;page=1;renderList();};
let searchTimer;
$('search').oninput=()=>{clearSelection();filtering=true;renderBulk();clearTimeout(searchTimer);searchTimer=setTimeout(()=>{filtering=false;page=1;renderList();},120);};
$('sort').onchange=()=>{page=1;renderList();};
$('prevPage').onclick=()=>{page--;renderList();$('list').scrollTop=0;};
$('nextPage').onclick=()=>{page++;renderList();$('list').scrollTop=0;};
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&$('edit')){e.preventDefault();if(!saving)$('edit').requestSubmit();}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('search').focus();}
});
$('import').onclick=()=>$('files').click();$('folder').onclick=()=>$('folders').click();
async function importFiles(files){
  if(importing){toast('正在导入，请稍候');return;}
  if(saving||$('batchDialog').open){toast('请先完成当前整理操作');return;}
  const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name));if(!pdfs.length){toast('没有找到 PDF 文件');return;}
  lastImported=[];$('showImported').hidden=true;importing=true;stopImport=false;$('stopImport').hidden=false;$('stopImport').disabled=false;$('progress').hidden=false;$('import').disabled=$('folder').disabled=true;renderBulk();
  let added=0,duplicates=0,trashDuplicates=0,processed=0,failed=[];
  for(let i=0;i<pdfs.length;i++){if(stopImport)break;const file=pdfs[i];$('progress').textContent=`正在导入 ${i+1} / ${pdfs.length}：${file.name}`;
    try{if(file.size>50*1024*1024)throw Error('超过 50 MB 限制');const result=await api('/api/import?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});if(result.duplicate){duplicates++;if(result.paper.trashed)trashDuplicates++;}else{added++;lastImported.push(result.paper.id);}}catch(e){failed.push(`${file.name}：${e.message}`);}processed++;}
  $('stopImport').hidden=true;$('files').value=$('folders').value='';
  $('progress').textContent=`${stopImport?'已停止':'导入完成'}：新增 ${added} 篇，重复 ${duplicates} 篇，失败 ${failed.length} 篇，未处理 ${pdfs.length-processed} 篇。${trashDuplicates?'其中 '+trashDuplicates+' 篇重复文献在回收站，请前往恢复。':''}${failed.length?'\n'+failed.join('\n'):''}`;
  try{await load();}catch(e){toast(e.message);}finally{importing=false;$('import').disabled=$('folder').disabled=false;renderBulk();}$('showImported').hidden=lastImported.length===0;toast('导入任务完成');
}
$('showImported').onclick=()=>{if(saving)return;clearSelection();view='recent';page=1;$('search').value='';renderList();};
$('stopImport').onclick=()=>{stopImport=true;$('stopImport').disabled=true;$('progress').textContent+='\n将在当前文件处理完成后停止。';};
$('files').onchange=e=>importFiles(e.target.files);$('folders').onchange=e=>importFiles(e.target.files);
document.addEventListener('dragover',e=>{e.preventDefault();});document.addEventListener('drop',e=>{e.preventDefault();importFiles(e.dataTransfer.files);});
$('export').onclick=()=>$('exportDialog').showModal();
$('closeExport').onclick=()=>$('exportDialog').close();
function downloadCatalog(endpoint,filename){const a=document.createElement('a');a.href=endpoint+'?token='+token;a.download=filename;a.click();}
$('exportJson').onclick=()=>downloadCatalog('/api/export','paperdesk-catalog.json');
$('exportBib').onclick=()=>downloadCatalog('/api/export.bib','paperdesk-references.bib');
$('backup').onclick=async()=>{
  if(backingUp)return;
  backingUp=true;$('backup').disabled=true;$('backupStatus').hidden=false;
  $('backupStatus').textContent='正在复制并校验文献，请保持程序运行。备份仅包含点击时已保存的内容。';
  try{
    const result=await api('/api/backup',{method:'POST'});
    $('backupStatus').textContent=`备份完成：${result.count} 篇，${(result.bytes/1024/1024).toFixed(2)} MB\n位置：${result.path}\n请将此文件夹复制到外部磁盘。恢复方法见 README。`;
    toast('完整备份已完成');
  }catch(e){$('backupStatus').textContent=e.message;toast('备份失败，请查看提示');}
  finally{backingUp=false;$('backup').disabled=false;}
};
$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
window.addEventListener('beforeunload',e=>{if(dirty||importing||saving||backingUp){e.preventDefault();e.returnValue='';}});
load().catch(e=>toast('无法连接文栖：'+e.message));
