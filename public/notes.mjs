export const NOTE_TEMPLATES = Object.freeze({
  summary: {label:'阅读摘要',text:'研究问题：\n\n研究方法：\n\n主要结论：\n\n创新点：\n\n不足：\n\n我的评价：\n'},
  experiment: {label:'实验记录',text:'实验目标：\n\n数据与样本：\n\n实验设置：\n\n对照与结果：\n\n复现要点：\n\n后续验证：\n'},
  review: {label:'综述整理',text:'研究主题：\n\n代表性方法：\n\n方法对比：\n\n共识与争议：\n\n研究空白：\n\n可引用观点：\n'},
});

// Appending keeps existing notes and avoids silently replacing selected text.
export function appendTemplate(notes,key){
  if(!Object.hasOwn(NOTE_TEMPLATES,key))throw Error('请选择有效的笔记模板');
  const next=notes+(notes?'\n\n':'')+NOTE_TEMPLATES[key].text;
  if(next.length>100000)throw Error('笔记已达到长度限制，无法追加模板');
  return next;
}

export function notePages(notes){
  return [...new Set([...notes.matchAll(/\[第 (\d{1,7}) 页\]/g)].map(m=>Number(m[1])).filter(p=>p>0))].slice(0,200);
}

export function appendExcerpt(notes,text,page){
  if(!Number.isSafeInteger(page)||page<1||typeof text!=='string'||!text.trim())throw Error('请先在 PDF 页面中选中文字');
  if(text.length>10000)throw Error('每次摘录最多 10000 字符，请缩小选区');
  const quote=text.trim().replace(/\r\n?/g,'\n').split('\n').map(line=>'> '+line).join('\n');
  const next=notes+(notes?'\n\n':'')+`[第 ${page} 页]\n${quote}\n`;
  if(next.length>100000)throw Error('笔记已达到长度限制，无法追加摘录');
  return next;
}

export function notesMarkdown(paper,notes,{draft=false}={}){
  // Escape title and metadata only; notes are the user's authored Markdown.
  const escape=value=>String(value??'').replace(/[\r\n]+/g,' ').replace(/[\\`*_{}\[\]<>()#!|]/g,'\\$&');
  const rows=[['作者',paper.authors],['年份',paper.year],['期刊 / 会议',paper.journal],['DOI',paper.doi],['关键词',paper.keywords],['标签',(paper.tags||[]).join('，')]];
  const meta=rows.filter(([,value])=>value).map(([label,value])=>`- ${label}：${escape(value)}`).join('\n');
  const status=draft?'导出包含当前未保存编辑；文献库中的记录尚未更新。':'导出内容来自当前文献笔记。';
  return `# ${escape(paper.title||'未命名文献')}\n\n${meta}${meta?'\n\n':''}${status}\n\n## 阅读笔记\n\n${notes}\n`;
}

export function notesFilename(title){
  const safe=String(title||'文献').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/[. ]+$/g,'').slice(0,80)||'文献';
  return safe+'-阅读笔记.md';
}
