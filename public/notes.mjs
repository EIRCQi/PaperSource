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
