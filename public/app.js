import {NOTE_TEMPLATES,appendTemplate,notePages} from './notes.mjs';
import {METADATA_FIELDS,METADATA_BATCH_LIMIT,metadataSuggestions} from './metadata-batch.mjs';
import {suggestTags,DEFAULT_RULES,validateRules,RULE_PRESETS,mergePresetRules} from './classify.mjs';
const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name="app-token"]').content;
const labels={all:'全部文献',favorite:'星标收藏',unread:'待阅读',reading:'阅读中',done:'已读完',trash:'回收站',tag:'标签分类',recent:'本次新增',uncategorized:'未分类',incomplete:'资料待补全',suggested:'有分类建议'};
const states={unread:'待阅读',reading:'阅读中',done:'已读完'};
let papers=[],view='all',tag='',selected=null,dirty=false,importing=false,saving=false,backingUp=false;
let page=1,stopImport=false,draftPrefix='',draftWarning=false;
let detailTab='reader',readerWide=false,readerPosition=null;
const PAGE_SIZE=50;
const searchIndex=new Map(),classSuggestions=new Map();
let classification={revision:0,rules:DEFAULT_RULES,autoOnImport:true};
const emptyDetail=$('detail').innerHTML;
let classPreview=[],classSettingsRevision=0,purgeItems=[];
const picked=new Map();
let visiblePage=[],lastImported=[],dataGeneration=0,filtering=false;
function renderBulk(){
  const count=picked.size;
  if($('insertPageNote'))$('insertPageNote').disabled=saving||!readerPosition;
  $('trashActions').hidden=view!=='trash';
  $('purgePicked').disabled=saving||importing||backingUp||!count;
  $('emptyTrash').disabled=saving||importing||backingUp||!papers.some(p=>p.trashed);
  $('classify').disabled=saving||importing;
  $('selectionCount').textContent=`已选 ${count} 篇`;
  $('clearSelection').disabled=saving||count===0;
  $('openBatch').disabled=saving||importing||filtering||count===0;
  $('recognizeSelected').hidden=view==='trash';$('recognizeSelected').disabled=saving||importing||filtering||count===0;
  $('trashSelected').hidden=view==='trash';$('trashSelected').disabled=saving||importing||filtering||count===0;
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
  searchIndex.clear();classSuggestions.clear();
  for(const p of papers)classSuggestions.set(p.id,suggestTags(p,classification.rules));
  for(const p of papers)searchIndex.set(p.id,[p.title,p.authors,p.year,p.doi,p.journal,p.keywords,p.notes,...p.tags].join(' ').normalize('NFKC').toLocaleLowerCase());
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
async function load(){const generation=dataGeneration;const data=await api('/api/papers');if(generation!==dataGeneration)return load();papers=data.papers;classification=data.classification;clearSelection();draftPrefix='paperdesk-draft:'+data.dataPath+':';rebuildIndex();$('dataPath').textContent=data.dataPath;renderList();}
function canLeave(){return !dirty||confirm('有尚未保存的修改，确定放弃这些修改吗？');}
function renderList(){
  const live=papers.filter(p=>!p.trashed);$('total').textContent=live.length;
  const tagCounts=new Map();for(const p of live)for(const t of p.tags)tagCounts.set(t,(tagCounts.get(t)||0)+1);
  const tags=[...tagCounts.keys()].sort((a,b)=>a.localeCompare(b,'zh'));
  $('tags').innerHTML=tags.length?tags.map(t=>`<button class="tag-nav ${view==='tag'&&tag===t?'active':''}" data-tag="${esc(t)}"># ${esc(t)} <small>${tagCounts.get(t)}</small></button>`).join(''):'<p class="muted">在文献详情中添加标签</p>';
  const q=$('search').value.trim().normalize('NFKC').toLocaleLowerCase();
  const terms=q.split(/\s+/).filter(Boolean);
  const recentIds=new Set(lastImported);
  let shown=papers.filter(p=>view==='trash'?p.trashed:!p.trashed).filter(p=>view==='uncategorized'?p.tags.length===0:view==='incomplete'?(!p.authors.trim()||!/^\d{4}$/.test(p.year)):view==='suggested'?(classSuggestions.get(p.id)||[]).length>0:view==='recent'?recentIds.has(p.id):view==='favorite'?p.favorite:view==='tag'?p.tags.includes(tag):states[view]?p.status===view:true).filter(p=>terms.every(term=>searchIndex.get(p.id)?.includes(term)));
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
function updateNoteCount(){
  if(!$('readingNotes'))return;
  const notes=$('readingNotes').value;
  $('noteCount').textContent=`${notes.length.toLocaleString('zh-CN')} 字符`;
  $('noteReferences').innerHTML=notePages(notes).map(page=>`<button type="button" data-note-page="${page}">第 ${page} 页 ↗</button>`).join('');
}
function showDetailTab(tab){
  detailTab=tab;const reading=tab==='reader';
  if(!$('readerPanel'))return;
  $('readerPanel').hidden=!reading;$('metadataPanel').hidden=reading;
  $('readerTab').setAttribute('aria-pressed',String(reading));$('metadataTab').setAttribute('aria-pressed',String(!reading));
  document.querySelector('.workspace').classList.toggle('reader-open',reading);
}
function setReaderWide(wide){
  readerWide=wide&&!!$('edit');const detail=$('detail');
  detail.classList.toggle('reader-wide',readerWide);document.body.classList.toggle('reader-focused',readerWide);
  document.querySelector('body>aside').inert=readerWide;
  for(const child of document.querySelector('main').children)if(!child.contains(detail))child.inert=readerWide;
  document.querySelector('.list-column').inert=readerWide;
  if(readerWide){detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.setAttribute('aria-label','文献阅读工作区');}
  else{detail.removeAttribute('role');detail.removeAttribute('aria-modal');detail.removeAttribute('aria-label');}
  if($('wideReader')){$('wideReader').textContent=readerWide?'退出宽屏':'宽屏阅读';$('wideReader').setAttribute('aria-pressed',String(readerWide));}
}
function field(key,label,value,placeholder=''){return `<label>${label}<input name="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${key==='title'?'required':''} maxlength="2000"></label>`;}
function renderDetail(){
  let p=papers.find(p=>p.id===selected);if(!p){setReaderWide(false);selected=null;dirty=false;$('detail').innerHTML=emptyDetail;document.querySelector('.workspace').classList.remove('reader-open');return;}
  let editRevision=p.revision||0;
  dirty=false;
  const pdf=`/api/papers/${p.id}/file?token=${token}`;
  readerPosition=null;
  $('detail').innerHTML=`<div class="detail-head"><strong id="readingTitle">${esc(p.title)}</strong><div>${p.trashed?'':`<a href="/api/export.bib?id=${p.id}&token=${token}" download>导出 BibTeX</a>　`}<a href="${pdf}" target="_blank" rel="noopener">打开 PDF ↗</a></div></div>
    <div class="reader-toolbar"><div role="group" aria-label="文献视图"><button type="button" id="readerTab" aria-controls="readerPanel">阅读与笔记</button><button type="button" id="metadataTab" aria-controls="metadataPanel">题录整理</button></div><button type="button" id="wideReader">宽屏阅读</button></div>
    <form id="edit"><div class="save-row reader-save"><button class="primary" type="submit" id="save">保存修改</button><span id="saveState" role="status">已保存</span><button type="button" id="reloadDetail">重新载入</button><button id="trash" type="button" class="${p.trashed?'':'danger'}">${p.trashed?'恢复文献':'删除（移入回收站）'}</button>${p.trashed?'<button id="purgeSingle" type="button" class="danger">彻底删除此篇</button>':''}</div>
    <section id="readerPanel" aria-label="阅读与笔记"><div class="reader-layout"><div class="pdf-pane"><iframe id="paperFrame" title="PDF 文献阅读" src="/reader.html?id=${p.id}&token=${token}"></iframe><p class="pdf-hint">无法显示 PDF？点击右上角“打开 PDF ↗”。</p></div><div class="notes-pane"><label for="readingNotes">阅读笔记 <span id="noteCount"></span></label><div class="note-tools"><button type="button" id="insertPageNote" disabled>插入当前页码</button><span id="readingPosition" role="status">正在读取 PDF…</span></div><div class="note-tools"><select id="noteTemplate" aria-label="笔记模板">${Object.entries(NOTE_TEMPLATES).map(([key,t])=>`<option value="${key}">${esc(t.label)}</option>`).join('')}</select><button type="button" id="appendTemplate">追加模板</button></div><div id="noteReferences" class="note-tools" aria-label="笔记页码跳转"></div><textarea id="readingNotes" name="notes" rows="12" maxlength="100000" placeholder="记录研究问题、主要方法、关键结论和自己的思考…">${esc(p.notes)}</textarea><p>切换视图会保留编辑内容；完成后点击上方保存修改。</p></div></div></section>
    <section id="metadataPanel" aria-label="题录整理" hidden><div class="metadata-bar"><button type="button" id="recognize">识别题录</button><span>${esc(p.metadata?.message||'可从 PDF 自动提取题录，结果需核对。')}</span></div><div class="form-title">${field('title','文献标题',p.title)}</div><div class="grid">${field('authors','作者',p.authors,'多位作者用分号分隔')}${field('year','发表年份',p.year,'例如：2026')}${field('journal','期刊 / 会议',p.journal)}${field('doi','DOI',p.doi)}</div>${field('keywords','论文关键词',p.keywords||'','论文中的关键词，用分号分隔')}${field('tags','标签',p.tags.join('，'),'用逗号分隔，例如：机器学习，待读综述')}<div class="status-row"><label>阅读状态<select name="status">${Object.entries(states).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="checkbox"><input type="checkbox" name="favorite" ${p.favorite?'checked':''}> 星标收藏</label></div></section></form><p class="file-meta">${esc(p.filename)} · ${(p.size/1024/1024).toFixed(2)} MB · ${new Date(p.createdAt).toLocaleDateString('zh-CN')} 导入</p>`;
  const form=$('edit');
  $('readerTab').onclick=()=>showDetailTab('reader');$('metadataTab').onclick=()=>showDetailTab('metadata');
  $('wideReader').onclick=()=>setReaderWide(!readerWide);
  $('appendTemplate').onclick=()=>{
    if(saving)return;
    const notes=$('readingNotes');
    try{notes.value=appendTemplate(notes.value,$('noteTemplate').value);notes.dispatchEvent(new Event('input',{bubbles:true}));notes.focus();notes.setSelectionRange(notes.value.length,notes.value.length);}catch(error){toast(error.message);}
  };
  $('noteReferences').onclick=event=>{
    const button=event.target.closest('[data-note-page]');if(!button||saving)return;
    const page=Number(button.dataset.notePage);
    if(!readerPosition){toast('请等待 PDF 页面载入后再跳转');return;}
    if(page>readerPosition.total){toast(`此文献只有 ${readerPosition.total} 页`);return;}
    $('paperFrame').contentWindow.postMessage({type:'reader-jump',id:p.id,page},location.origin);
  };
  $('insertPageNote').onclick=()=>{
    if(saving||!readerPosition||readerPosition.id!==p.id)return;
    const notes=$('readingNotes'),marker=`\n\n[第 ${readerPosition.page} 页]\n`;
    if(notes.value.length-(notes.selectionEnd-notes.selectionStart)+marker.length>100000){toast('笔记已达到长度限制');return;}
    notes.setRangeText(marker,notes.selectionStart,notes.selectionEnd,'end');notes.dispatchEvent(new Event('input',{bubbles:true}));notes.focus();
  };
  form.addEventListener('invalid',event=>{if($('metadataPanel').contains(event.target))showDetailTab('metadata');},true);
  if($('purgeSingle'))$('purgeSingle').onclick=()=>openPurge(false,{id:p.id,revision:editRevision});
  $('recognize').onclick=()=>recognizePaper(p,form,editRevision);
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
  updateNoteCount();showDetailTab(detailTab);setReaderWide(readerWide);
  form.addEventListener('input',()=>{
    updateNoteCount();dirty=true;const stored=storeDraft(p.id,editRevision,form);$('saveState').textContent=stored?'未保存 · 草稿已暂存':'未保存 · 请及时保存';
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(saving)return;saving=true;
    const changes={...formValues(form),expectedRevision:editRevision};
    const controls=[...form.elements];controls.forEach(c=>c.disabled=true);
    try{
      const updated=await api('/api/papers/'+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
      dataGeneration++;papers=papers.map(x=>x.id===p.id?updated:x);p=updated;editRevision=updated.revision;if(picked.has(p.id))picked.set(p.id,updated.revision);
      deleteDraft(p.id);dirty=false;$('readingTitle').textContent=p.title;$('saveState').textContent='已保存';rebuildIndex();renderList();toast('修改已保存');
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

}
$('list').onclick=e=>{const b=e.target.closest('[data-id]');if(!b||saving||!canLeave())return;if(dirty&&selected)deleteDraft(selected);selected=b.dataset.id;detailTab='reader';renderList();renderDetail();$('detail').scrollIntoView({block:'start'});};
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
$('trashSelected').onclick=()=>{
  if(saving||importing||filtering||!picked.size||view==='trash')return;
  $('openBatch').click();if($('batchDialog').open){$('batchAction').value='trash';batchFields();}
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
  if(readerWide&&!document.querySelector('dialog[open]')){
    if(e.key==='Escape'){e.preventDefault();setReaderWide(false);$('wideReader')?.focus();}
    if(e.key==='Tab'){
      const targets=[...$('detail').querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),iframe')].filter(el=>el.getClientRects().length);
      if(e.shiftKey&&document.activeElement===targets[0]){e.preventDefault();targets.at(-1)?.focus();}
      else if(!e.shiftKey&&document.activeElement===targets.at(-1)){e.preventDefault();targets[0]?.focus();}
    }
  }
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!saving&&!document.querySelector('dialog[open]')&&$('edit'))$('edit').requestSubmit();}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!document.querySelector('dialog[open]')){setReaderWide(false);$('search').focus();}}
});
$('import').onclick=()=>$('files').click();$('folder').onclick=()=>$('folders').click();
async function importFiles(files){
  if(importing){toast('正在导入，请稍候');return;}
  if(saving||$('batchDialog').open||$('classDialog').open||$('purgeDialog').open||$('metadataDialog').open||$('batchMetadataDialog').open){toast('请先完成当前整理操作');return;}
  const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name));if(!pdfs.length){toast('没有找到 PDF 文件');return;}
  lastImported=[];$('showImported').hidden=true;importing=true;stopImport=false;$('stopImport').hidden=false;$('stopImport').disabled=false;$('progress').hidden=false;$('import').disabled=$('folder').disabled=true;renderBulk();
  let added=0,classified=0,recognized=0,needsMetadata=0,duplicates=0,trashDuplicates=0,processed=0,failed=[];
  for(let i=0;i<pdfs.length;i++){if(stopImport)break;const file=pdfs[i];$('progress').textContent=`正在导入 ${i+1} / ${pdfs.length}：${file.name}`;
    try{if(file.size>50*1024*1024)throw Error('超过 50 MB 限制');const result=await api('/api/import?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});if(result.duplicate){duplicates++;if(result.paper.trashed)trashDuplicates++;}else{added++;if(result.paper.metadata?.status==='recognized')recognized++;else needsMetadata++;if(result.paper.tags.length)classified++;lastImported.push(result.paper.id);}}catch(e){failed.push(`${file.name}：${e.message}`);}processed++;}
  $('stopImport').hidden=true;$('files').value=$('folders').value='';
  $('progress').textContent=`${stopImport?'已停止':'导入完成'}：新增 ${added} 篇（识别题录 ${recognized} 篇，自动分类 ${classified} 篇，题录待手填 ${needsMetadata} 篇），重复 ${duplicates} 篇，失败 ${failed.length} 篇，未处理 ${pdfs.length-processed} 篇。${trashDuplicates?'其中 '+trashDuplicates+' 篇重复文献在回收站，请前往恢复。':''}${failed.length?'\n'+failed.join('\n'):''}`;
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
  backingUp=true;renderBulk();$('backup').disabled=true;$('backupStatus').hidden=false;
  $('backupStatus').textContent='正在复制并校验文献，请保持程序运行。备份仅包含点击时已保存的内容。';
  try{
    const result=await api('/api/backup',{method:'POST'});
    $('backupStatus').textContent=`备份完成：${result.count} 篇，${(result.bytes/1024/1024).toFixed(2)} MB\n位置：${result.path}\n请将此文件夹复制到外部磁盘。恢复方法见 README。`;
    toast('完整备份已完成');
  }catch(e){$('backupStatus').textContent=e.message;toast('备份失败，请查看提示');}
  finally{backingUp=false;$('backup').disabled=false;renderBulk();}
};

function readRules(){
  const rules=$('classRules').value.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{
    const split=line.search(/[=＝]/);if(split<1)throw Error(`第 ${index+1} 行需要“标签 = 关键词, 关键词”`);
    return {tag:line.slice(0,split).trim(),keywords:line.slice(split+1).split(/[,，]/).map(k=>k.trim()).filter(Boolean)};
  });return validateRules(rules);
}
function selectedSuggestions(){
  const ids=new Set([...document.querySelectorAll('[data-class-pick]:checked')].map(input=>input.dataset.classPick));
  return classPreview.filter(p=>ids.has(p.id)).map(({id,expectedRevision})=>({id,expectedRevision}));
}
function refreshClassButton(){$('applyClass').disabled=saving||selectedSuggestions().length===0;}
function dialogBusy(form,busy){for(const field of $(form).elements)field.disabled=busy;}
$('classify').onclick=async()=>{
  if(saving||importing)return;if(dirty){toast('请先保存当前编辑');return;}
  saving=true;editorEnabled(false);renderBulk();
  try{
    const config=await api('/api/classify/settings');
    classSettingsRevision=config.revision;classPreview=[];
    $('classRules').value=config.rules.map(r=>r.tag+' = '+r.keywords.join(', ')).join('\n');
    $('autoImport').checked=config.autoOnImport;$('classResults').innerHTML='';$('classSummary').textContent='编辑规则后点击预览，核对匹配关键词再应用。';$('classError').hidden=true;
    $('classDialog').showModal();
  }catch(e){toast(e.message);}finally{saving=false;editorEnabled(true);renderBulk();refreshClassButton();}
};
$('rulePreset').innerHTML=RULE_PRESETS.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}（${p.tags.length} 类）</option>`).join('');
$('addPreset').onclick=()=>{
  if(saving)return;
  try{
    const result=mergePresetRules(readRules(),$('rulePreset').value);
    $('classRules').value=result.rules.map(r=>r.tag+' = '+r.keywords.join(', ')).join('\n');
    $('classRules').dispatchEvent(new Event('input'));$('classError').hidden=true;
    $('classSummary').textContent=`已补充 ${result.added} 条，共 ${result.rules.length} 条。同名规则保持原样；预览后应用，或点击“仅保存规则”。`;
  }catch(error){$('classError').textContent=error.message;$('classError').hidden=false;}
};
$('classRules').oninput=()=>{classPreview=[];$('classResults').innerHTML='';$('classSummary').textContent='规则已变化，请重新预览。';refreshClassButton();};
$('classResults').onchange=refreshClassButton;
$('classForm').onsubmit=async e=>{
  e.preventDefault();if(saving)return;
  saving=true;dialogBusy('classForm',true);$('classError').hidden=true;classPreview=[];$('classResults').innerHTML='';
  try{
    const result=await api('/api/classify/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:readRules()})});
    classPreview=result.suggestions;
    $('classSummary').textContent=`找到 ${result.total} 篇可分类文献，本次展示 ${classPreview.length} 篇（每次最多 500 篇）。可取消不合适的建议。`;
    $('classResults').innerHTML=classPreview.map(p=>`<label class="class-result"><input type="checkbox" data-class-pick="${p.id}" checked><span><strong>${esc(p.title)}</strong><small>${p.matches.map(m=>`${esc(m.tag)} ← ${m.keywords.map(esc).join('、')}`).join('；')}</small></span></label>`).join('');
  }catch(error){$('classError').textContent=error.message;$('classError').hidden=false;}
  finally{saving=false;dialogBusy('classForm',false);refreshClassButton();}
};
async function saveClassification(apply){
  if(saving)return;const items=apply?selectedSuggestions():[];
  if(apply&&!items.length)return;
  saving=true;dialogBusy('classForm',true);$('classError').hidden=true;editorEnabled(false);
  try{
    const result=await api('/api/classify/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,rules:readRules(),autoOnImport:$('autoImport').checked,expectedSettingsRevision:classSettingsRevision})});
    dataGeneration++;classification=result.classification;const changed=new Map(result.papers.map(p=>[p.id,p]));papers=papers.map(p=>changed.get(p.id)||p);clearSelection();rebuildIndex();if(changed.has(selected))renderDetail();$('classDialog').close();toast(`规则已保存，已分类 ${result.count} 篇文献`);
  }catch(error){$('classError').textContent=error.message;$('classError').hidden=false;}
  finally{saving=false;editorEnabled(true);dialogBusy('classForm',false);refreshClassButton();renderList();}
}
$('applyClass').onclick=()=>saveClassification(true);
$('saveClassRules').onclick=()=>saveClassification(false);
$('closeClass').onclick=()=>{if(!saving)$('classDialog').close();};
$('classDialog').addEventListener('cancel',e=>{if(saving)e.preventDefault();});
function openPurge(all,single=null){
  if(saving||importing||backingUp)return;if(dirty){toast('请先保存当前编辑');return;}
  const chosen=papers.filter(p=>p.trashed&&(single?p.id===single.id:all||picked.has(p.id)));
  if(!chosen.length){toast('没有可清除的文献');return;}
  if(chosen.length>10000){toast('每次最多清除 10000 篇，请使用勾选删除分批处理');return;}
  purgeItems=chosen.map(p=>({id:p.id,expectedRevision:single?single.revision:all?p.revision||0:picked.get(p.id)}));
  $('purgeSummary').textContent=`${single?'当前这篇文献':all?'整个回收站（包括搜索或筛选外的文献）':'勾选的回收站文献'}：${chosen.length} 篇。${chosen.slice(0,3).map(p=>p.title).join('、')}${chosen.length>3?'…':''}`;
  $('purgePhrase').textContent=`永久删除 ${chosen.length} 篇`;$('purgeConfirm').value='';$('confirmPurge').disabled=true;$('purgeError').hidden=true;$('purgeDialog').showModal();
}
$('emptyTrash').onclick=()=>openPurge(true);$('purgePicked').onclick=()=>openPurge(false);
$('purgeConfirm').oninput=()=>{$('confirmPurge').disabled=$('purgeConfirm').value!==`永久删除 ${purgeItems.length} 篇`;};
$('cancelPurge').onclick=()=>{if(!saving)$('purgeDialog').close();};
$('purgeDialog').addEventListener('cancel',e=>{if(saving)e.preventDefault();});
$('purgeForm').onsubmit=async e=>{
  e.preventDefault();if(saving)return;saving=true;dialogBusy('purgeForm',true);editorEnabled(false);$('purgeError').hidden=true;
  try{
    const result=await api('/api/purge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:purgeItems,confirmation:$('purgeConfirm').value})});
    dataGeneration++;const removed=new Set(result.ids);papers=papers.filter(p=>!removed.has(p.id));for(const id of removed)deleteDraft(id);clearSelection();rebuildIndex();if(removed.has(selected))renderDetail();$('purgeDialog').close();toast(result.warning||`已彻底清除 ${result.count} 篇文献`);
  }catch(error){$('purgeError').textContent=error.message;$('purgeError').hidden=false;}
  finally{saving=false;dialogBusy('purgeForm',false);editorEnabled(true);renderList();}
};

$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
window.addEventListener('beforeunload',e=>{if(dirty||importing||saving||backingUp){e.preventDefault();e.returnValue='';}});
load().catch(e=>toast('无法连接文栖：'+e.message));

const metadataLabels=METADATA_FIELDS;
let metadataContext=null;
async function recognizePaper(p,form,revision){
  if(saving||importing){toast('请等待当前操作完成');return;}
  saving=true;editorEnabled(false);renderBulk();
  metadataContext=null;$('metadataResults').innerHTML='';$('metadataMessage').textContent='正在读取 PDF 题录与前两页文字…';
  $('applyMetadata').disabled=true;$('closeMetadata').disabled=true;$('metadataDialog').showModal();
  try{
    const result=await api('/api/papers/'+p.id+'/metadata',{method:'POST'});
    if(result.expectedRevision!==revision)throw Error('当前编辑基于旧版本，请先保留草稿并重新载入最新文献。');
    metadataContext={form,result,id:p.id};
    $('metadataMessage').textContent=result.message+' 勾选要填入的字段；已有内容默认不勾选。';
    $('metadataResults').innerHTML=Object.entries(metadataLabels).filter(([key])=>result.fields[key]).map(([key,label])=>{
      const current=form.elements.namedItem(key).value;
      const filenameTitle=p.filename.replace(/\.pdf$/i,'').trim();
      const checked=!current.trim()||(key==='title'&&current===filenameTitle);
      return `<label class="metadata-choice"><input type="checkbox" data-metadata="${key}" ${checked?'checked':''}><span><strong>${label}</strong><small>当前：${esc(current)||'未填写'}</small><b>${esc(result.fields[key])}</b><small>${esc(result.sources[key])}</small></span></label>`;
    }).join('');
    updateMetadataButton();
  }catch(error){$('metadataMessage').textContent=error.message;}
  finally{saving=false;editorEnabled(true);renderBulk();$('closeMetadata').disabled=false;}
}
function updateMetadataButton(){$('applyMetadata').disabled=!document.querySelector('#metadataResults input:checked');}
$('metadataResults').onchange=updateMetadataButton;
$('metadataDialog').addEventListener('cancel',e=>{if(saving)e.preventDefault();else metadataContext=null;});
$('closeMetadata').onclick=()=>{if(!saving){$('metadataDialog').close();metadataContext=null;}};
$('applyMetadata').onclick=()=>{
  const context=metadataContext;if(saving||!context||selected!==context.id||!context.form.isConnected)return;
  for(const input of document.querySelectorAll('#metadataResults input:checked')){
    const key=input.dataset.metadata;context.form.elements.namedItem(key).value=context.result.fields[key];
  }
  context.form.dispatchEvent(new Event('input',{bubbles:true}));
  $('metadataDialog').close();metadataContext=null;toast('已填入编辑框，请核对并点击“保存修改”');
};

let recognitionItems=[],recognitionRows=[],recognitionStop=false,recognitionRunning=false;
function batchMetadataSelection(){
  const items=[];
  for(const [index,row] of recognitionRows.entries()){
    const fields={};
    for(const input of document.querySelectorAll(`[data-recognition-row="${index}"]:checked`))fields[input.dataset.field]=row.fields[input.dataset.field];
    if(Object.keys(fields).length)items.push({id:row.id,expectedRevision:row.expectedRevision,fields});
  }
  return items;
}
function refreshMetadataApply(){
  const items=batchMetadataSelection();$('applyBatchMetadata').disabled=saving||recognitionRunning||!items.length;
  $('applyBatchMetadata').textContent=items.length?`保存 ${items.length} 篇的勾选题录`:'保存勾选的题录';
}
function renderRecognitionRows(){
  $('batchMetadataResults').innerHTML=recognitionRows.map((row,index)=>`<section class="recognition-result"><h3>${esc(row.title)}</h3><p>${esc(row.message)}</p>${Object.entries(row.fields).map(([key,value])=>`<label class="metadata-choice"><input type="checkbox" data-recognition-row="${index}" data-field="${key}" checked ${recognitionRunning?'disabled':''}><span><strong>${esc(METADATA_FIELDS[key])}</strong><b>${esc(value)}</b><small>${esc(row.sources?.[key]||'PDF 题录候选，请核对')}</small></span></label>`).join('')}</section>`).join('');
  refreshMetadataApply();
}
$('recognizeSelected').onclick=()=>{
  if(saving||importing||filtering||!picked.size)return;
  if(dirty){toast('请先保存当前编辑，再批量识别题录');return;}
  if(picked.size>METADATA_BATCH_LIMIT){toast('批量识别每次最多 100 篇，请减少选择');return;}
  recognitionItems=papers.filter(p=>picked.has(p.id)&&!p.trashed).map(p=>({...p,expectedRevision:picked.get(p.id)}));
  if(!recognitionItems.length)return;
  recognitionRows=[];recognitionStop=false;$('batchMetadataResults').innerHTML='';$('batchMetadataError').hidden=true;
  $('batchMetadataStatus').textContent=`已选 ${recognitionItems.length} 篇。点击开始后逐篇识别，预览阶段不会修改文献。`;
  $('startBatchMetadata').hidden=false;$('startBatchMetadata').disabled=false;$('stopBatchMetadata').hidden=true;refreshMetadataApply();$('batchMetadataDialog').showModal();
};
$('startBatchMetadata').onclick=async()=>{
  if(saving||recognitionRunning)return;
  recognitionRunning=true;saving=true;recognitionStop=false;recognitionRows=[];editorEnabled(false);renderBulk();
  $('startBatchMetadata').hidden=true;$('stopBatchMetadata').hidden=false;$('stopBatchMetadata').disabled=false;$('closeBatchMetadata').disabled=true;$('batchMetadataError').hidden=true;
  try{
    for(const paper of recognitionItems){
      if(recognitionStop)break;
      $('batchMetadataStatus').textContent=`正在识别 ${recognitionRows.length+1} / ${recognitionItems.length}：${paper.title}`;
      let row={id:paper.id,title:paper.title,expectedRevision:paper.expectedRevision,fields:{},message:''};
      try{
        const result=await api('/api/papers/'+paper.id+'/metadata',{method:'POST'});
        if(result.expectedRevision!==paper.expectedRevision)throw Error('文献已变化，本篇跳过；请刷新列表后重试。');
        row.fields=metadataSuggestions(paper,result.fields);row.sources=result.sources;
        row.message=Object.keys(row.fields).length?'勾选需要补全的字段。':result.status==='recognized'?'已有题录保留，本篇没有可补全的空字段。':result.message;
      }catch(error){row.message=error.message;}
      recognitionRows.push(row);renderRecognitionRows();
    }
  }finally{
    recognitionRunning=false;saving=false;editorEnabled(true);renderBulk();$('stopBatchMetadata').hidden=true;$('closeBatchMetadata').disabled=false;
    const ready=recognitionRows.filter(r=>Object.keys(r.fields).length).length;
    $('batchMetadataStatus').textContent=`${recognitionStop?'已停止':'识别完成'}：已处理 ${recognitionRows.length} / ${recognitionItems.length} 篇，可补全 ${ready} 篇，跳过 ${recognitionRows.length-ready} 篇，未处理 ${recognitionItems.length-recognitionRows.length} 篇。尚未保存；请核对下方候选。`;
    renderRecognitionRows();
  }
};
$('stopBatchMetadata').onclick=()=>{recognitionStop=true;$('stopBatchMetadata').disabled=true;$('batchMetadataStatus').textContent+=' 当前文献完成后停止。';};
$('batchMetadataResults').onchange=refreshMetadataApply;
$('batchMetadataDialog').addEventListener('cancel',e=>{if(saving||recognitionRunning)e.preventDefault();});
$('closeBatchMetadata').onclick=()=>{if(!saving&&!recognitionRunning)$('batchMetadataDialog').close();};
$('applyBatchMetadata').onclick=async()=>{
  if(saving||recognitionRunning)return;const items=batchMetadataSelection();if(!items.length)return;
  saving=true;editorEnabled(false);refreshMetadataApply();$('closeBatchMetadata').disabled=true;$('batchMetadataError').hidden=true;
  const checkboxes=[...document.querySelectorAll('[data-recognition-row]')];checkboxes.forEach(e=>e.disabled=true);
  try{
    const result=await api('/api/metadata/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});
    dataGeneration++;const changed=new Map(result.papers.map(p=>[p.id,p]));papers=papers.map(p=>changed.get(p.id)||p);clearSelection();rebuildIndex();
    if(changed.has(selected))renderDetail();$('batchMetadataDialog').close();toast(`已补全 ${result.count} 篇题录，可在“自动分类”预览新的分类建议`);
  }catch(error){$('batchMetadataError').textContent=error.message;$('batchMetadataError').hidden=false;}
  finally{saving=false;editorEnabled(true);checkboxes.forEach(e=>e.disabled=false);$('closeBatchMetadata').disabled=false;refreshMetadataApply();renderList();}
};

window.addEventListener('message',event=>{
  const frame=$('paperFrame');if(!frame||event.origin!==location.origin||event.source!==frame.contentWindow)return;
  const message=event.data;if(!message||message.id!==selected)return;
  if(message.type==='reader-save'){if(!saving&&!document.querySelector('dialog[open]'))$('edit')?.requestSubmit();return;}
  if(message.type==='reader-exit-wide'){if(readerWide){setReaderWide(false);$('wideReader')?.focus();}return;}
  const key='paperdesk-reading:'+draftPrefix+selected;
  if(message.type==='reader-ready'){
    let progress=null;try{progress=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    frame.contentWindow.postMessage({type:'reader-init',id:selected,progress},location.origin);return;
  }
  if(message.type==='reader-busy'||message.type==='reader-error'){
    readerPosition=null;if($('insertPageNote'))$('insertPageNote').disabled=true;
    if($('readingPosition'))$('readingPosition').textContent=message.type==='reader-error'?'PDF 暂不可读，可使用“打开 PDF”':'正在读取 PDF…';return;
  }
  if(message.type!=='reader-progress'||!Number.isSafeInteger(message.page)||!Number.isSafeInteger(message.total)||message.page<1||message.page>message.total||!['width','0.5','0.75','1','1.25','1.5','2'].includes(message.zoom))return;
  readerPosition={id:selected,page:message.page,total:message.total,zoom:message.zoom};
  let stored=true;try{localStorage.setItem(key,JSON.stringify({page:message.page,zoom:message.zoom}));}catch{stored=false;}
  if($('readingPosition'))$('readingPosition').textContent=`第 ${message.page} / ${message.total} 页${stored?' · 本浏览器已记住位置':' · 浏览器无法保存位置'}`;
  if($('insertPageNote'))$('insertPageNote').disabled=saving;
});
