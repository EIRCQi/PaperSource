const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name="app-token"]').content;
const labels={all:'全部文献',favorite:'星标收藏',unread:'待阅读',reading:'阅读中',done:'已读完',trash:'回收站',tag:'标签分类'};
const states={unread:'待阅读',reading:'阅读中',done:'已读完'};
let papers=[],view='all',tag='',selected=null,dirty=false,importing=false,saving=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'X-PaperDesk-Token':token,...options.headers}});const result=await r.json();if(!r.ok)throw Error(result.error||'操作失败');return result;}
async function load(){const data=await api('/api/papers');papers=data.papers;$('dataPath').textContent=data.dataPath;renderList();}
function canLeave(){return !dirty||confirm('有尚未保存的修改，确定放弃这些修改吗？');}
function renderList(){
  const live=papers.filter(p=>!p.trashed);$('total').textContent=live.length;
  const tags=[...new Set(live.flatMap(p=>p.tags))].sort((a,b)=>a.localeCompare(b,'zh'));
  $('tags').innerHTML=tags.length?tags.map(t=>`<button class="tag-nav ${view==='tag'&&tag===t?'active':''}" data-tag="${esc(t)}"># ${esc(t)} <small>${live.filter(p=>p.tags.includes(t)).length}</small></button>`).join(''):'<p class="muted">在文献详情中添加标签</p>';
  const q=$('search').value.trim().toLocaleLowerCase();
  let shown=papers.filter(p=>view==='trash'?p.trashed:!p.trashed).filter(p=>view==='favorite'?p.favorite:view==='tag'?p.tags.includes(tag):states[view]?p.status===view:true).filter(p=>[p.title,p.authors,p.year,p.doi,p.journal,p.notes,...p.tags].join(' ').toLocaleLowerCase().includes(q));
  shown.sort((a,b)=>$('sort').value==='title'?a.title.localeCompare(b.title,'zh'):$('sort').value==='year'?String(b.year).localeCompare(String(a.year)):b.createdAt.localeCompare(a.createdAt));
  $('heading').textContent=view==='tag'?'# '+tag:labels[view];$('summary').textContent=`${shown.length} 篇文献 · ${live.filter(p=>p.status==='done').length} 篇已读完`;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('list').innerHTML=shown.length?shown.map(p=>`<button class="paper ${selected===p.id?'selected':''}" data-id="${p.id}"><div class="paper-top"><span class="pdf">PDF</span><span>${esc(p.year)||'年份待补充'} ${p.favorite?'★':''}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.authors)||'作者待补充'}</p><div class="paper-bottom"><span class="status ${p.status}">${states[p.status]}</span><span>${p.tags.slice(0,2).map(t=>'# '+esc(t)).join('　')}</span></div></button>`).join(''):`<div class="empty"><h3>${q?'没有找到匹配文献':view==='all'?'文献库还是空的':'这里还没有文献'}</h3><p>${q?'试试其他关键词。':'导入 PDF，或调整分类与阅读状态。'}</p></div>`;
}
function field(key,label,value,placeholder=''){return `<label>${label}<input name="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${key==='title'?'required':''} maxlength="2000"></label>`;}
function renderDetail(){
  const p=papers.find(p=>p.id===selected);if(!p)return;
  dirty=false;
  const pdf=`/api/papers/${p.id}/file?token=${token}`;
  $('detail').innerHTML=`<div class="detail-head"><span>文献详情</span><a href="${pdf}" target="_blank" rel="noopener">打开 PDF ↗</a></div><form id="edit"><div class="form-title">${field('title','文献标题',p.title)}</div><div class="grid">${field('authors','作者',p.authors,'多位作者用分号分隔')}${field('year','发表年份',p.year,'例如：2026')}${field('journal','期刊 / 会议',p.journal)}${field('doi','DOI',p.doi)}</div>${field('tags','标签',p.tags.join('，'),'用逗号分隔，例如：机器学习，待读综述')}<div class="status-row"><label>阅读状态<select name="status">${Object.entries(states).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="checkbox"><input type="checkbox" name="favorite" ${p.favorite?'checked':''}> 星标收藏</label></div><label>阅读笔记<textarea name="notes" rows="6" maxlength="100000" placeholder="研究问题、主要结论，以及你的思考…">${esc(p.notes)}</textarea></label><div class="save-row"><button class="primary" type="submit" id="save">保存修改</button><span id="saveState">已保存</span><button class="subtle" id="trash" type="button">${p.trashed?'恢复文献':'移入回收站'}</button></div></form><details class="preview"><summary>展开 PDF 预览</summary><iframe title="PDF 文献预览" data-src="${pdf}"></iframe></details><p class="file-meta">${esc(p.filename)} · ${(p.size/1024/1024).toFixed(2)} MB · ${new Date(p.createdAt).toLocaleDateString('zh-CN')} 导入</p>`;
  const form=$('edit');form.addEventListener('input',()=>{dirty=true;$('saveState').textContent='有未保存的修改';});
  form.addEventListener('submit',async e=>{e.preventDefault();if(saving)return;saving=true;const data=new FormData(form),changes=Object.fromEntries(data);changes.favorite=data.has('favorite');changes.tags=data.get('tags').split(/[,，]/).map(t=>t.trim()).filter(Boolean);const controls=[...form.elements];controls.forEach(c=>c.disabled=true);try{const updated=await api('/api/papers/'+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});papers=papers.map(x=>x.id===p.id?updated:x);dirty=false;$('saveState').textContent='已保存';renderList();toast('修改已保存');}catch(e){toast(e.message);}finally{controls.forEach(c=>c.disabled=false);saving=false;}});
  $('trash').onclick=async()=>{if(!canLeave())return;try{const updated=await api('/api/papers/'+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:!p.trashed})});papers=papers.map(x=>x.id===p.id?updated:x);renderList();renderDetail();toast(p.trashed?'文献已恢复':'已移入回收站，可随时恢复');}catch(e){toast(e.message);}};
  document.querySelector('.preview').addEventListener('toggle',e=>{const frame=e.target.querySelector('iframe');if(e.target.open&&!frame.src)frame.src=frame.dataset.src;});
}
$('list').onclick=e=>{const b=e.target.closest('[data-id]');if(!b||saving||!canLeave())return;selected=b.dataset.id;renderList();renderDetail();};
$('nav').onclick=e=>{const b=e.target.closest('[data-view]');if(!b)return;view=b.dataset.view;renderList();};
$('tags').onclick=e=>{const b=e.target.closest('[data-tag]');if(!b)return;view='tag';tag=b.dataset.tag;renderList();};
$('search').oninput=renderList;$('sort').onchange=renderList;
$('import').onclick=()=>$('files').click();$('folder').onclick=()=>$('folders').click();
async function importFiles(files){
  if(importing){toast('正在导入，请稍候');return;}
  const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name));if(!pdfs.length){toast('没有找到 PDF 文件');return;}
  importing=true;$('progress').hidden=false;$('import').disabled=$('folder').disabled=true;
  let added=0,duplicates=0,failed=[];
  for(let i=0;i<pdfs.length;i++){const file=pdfs[i];$('progress').textContent=`正在导入 ${i+1} / ${pdfs.length}：${file.name}`;
    try{if(file.size>50*1024*1024)throw Error('超过 50 MB 限制');const result=await api('/api/import?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});if(result.duplicate)duplicates++;else added++;}catch(e){failed.push(`${file.name}：${e.message}`);}}
  importing=false;$('import').disabled=$('folder').disabled=false;$('files').value=$('folders').value='';
  $('progress').textContent=`导入完成：新增 ${added} 篇，重复 ${duplicates} 篇，失败 ${failed.length} 篇。${failed.length?'\n'+failed.join('\n'):''}`;
  try{await load();}catch(e){toast(e.message);}toast('导入任务完成');
}
$('files').onchange=e=>importFiles(e.target.files);$('folders').onchange=e=>importFiles(e.target.files);
document.addEventListener('dragover',e=>{e.preventDefault();});document.addEventListener('drop',e=>{e.preventDefault();importFiles(e.dataTransfer.files);});
$('export').onclick=()=>{const a=document.createElement('a');a.href='/api/export?token='+token;a.download='paperdesk-catalog.json';a.click();};
$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
window.addEventListener('beforeunload',e=>{if(dirty||importing||saving){e.preventDefault();e.returnValue='';}});
load().catch(e=>toast('无法连接文栖：'+e.message));
