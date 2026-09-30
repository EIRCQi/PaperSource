import {Worker} from 'node:worker_threads';

const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufeff]/g,' ').replace(/\s+/g,' ').trim().slice(0,2000):'';
const placeholder=value=>!value||/^(untitled|unknown|anonymous|author|title|admin|user|无标题|未知|作者|标题)$/i.test(value)||/^(microsoft (word|powerpoint)|acrobat|adobe|latex|doi:|https?:)/i.test(value)||/\.(docx?|tex|pdf)$/i.test(value);
const heading=/^(abstract\b|摘要|摘\s*要|keywords?\b|key words\b|index terms\b|关\s*键\s*词|参考文献|references\b|\d*[.\s]*introduction\b|引言)/i;
const affiliation=/university|institute|department|laboratory|school of|@|大学|学院|研究所|实验室|收稿|基金|通讯作者|correspond/i;
export function keywordText(value){
  const raw=Array.isArray(value)?value.join('; '):clean(value);
  return [...new Set(raw.split(/[;,；，、]+/).map(x=>clean(x).replace(/[.。]+$/,'')).filter(Boolean))].slice(0,50).join('; ').slice(0,2000);
}
// Keep layout information so a journal header is not blindly used as the title.
export function textLines(items){
  const lines=[];let line=null;
  for(const item of items){
    if(typeof item.str!=='string'||!item.str.trim())continue;
    const [a,b,,,x,y]=item.transform||[0,0,0,0,0,0];
    const size=Math.hypot(a,b)||item.height||10;
    if(!line||Math.abs(y-line.y)>Math.max(2,size*.3)||x<line.x-10){
      line={text:'',size,x,y,end:x};lines.push(line);
    }
    const gap=x-line.end;
    const join=line.text&&gap>size*.15&&!/[\u3400-\u9fff]$/.test(line.text)?' ':'';
    line.text+=join+item.str;line.size=Math.max(line.size,size);line.end=x+(item.width||0);
    if(item.hasEOL)line=null;
  }
  return lines.map(l=>({...l,text:clean(l.text)})).filter(l=>l.text);
}
export function inferMetadata({info={},xmp={},pages=[]}={}){
  const fields={},sources={};
  const put=(key,value,source)=>{value=clean(value);if(value&&!fields[key]){fields[key]=value;sources[key]=source;}};
  const first=(...values)=>values.map(v=>Array.isArray(v)?v.join('; '):clean(v)).find(v=>v&&!placeholder(v))||'';
  put('title',first(xmp['dc:title'],info.Title),'PDF 内嵌题录');
  put('authors',first(xmp['dc:creator'],info.Author).replace(/\s+and\s+|；/gi,'; '),'PDF 内嵌题录');
  put('keywords',keywordText(xmp['dc:subject']||xmp['pdf:keywords']||info.Keywords||''),'PDF 内嵌关键词');
  put('journal',first(xmp['prism:publicationname'],xmp['prism:publicationName']),'PDF 内嵌题录');
  const pubdate=clean(xmp['prism:publicationdate']||xmp['prism:publicationDate']);
  if(/^(19|20)\d{2}\b/.test(pubdate))put('year',pubdate.slice(0,4),'PDF 内嵌发表日期');
  const firstPage=(pages[0]||[]).slice(0,100);
  const boundary=firstPage.findIndex(l=>heading.test(l.text));
  const front=firstPage.slice(0,boundary<0?30:boundary);
  let titleEnd=-1;
  if(!fields.title){
    const eligible=front.map((l,i)=>({...l,i})).filter(l=>l.text.length>=6&&l.text.length<=300&&!affiliation.test(l.text)&&!placeholder(l.text)&&!/^(arxiv|vol\.|journal\b|proceedings\b|copyright|©|issn)/i.test(l.text));
    const ranked=[...eligible].sort((a,b)=>b.size-a.size||a.i-b.i);
    const best=ranked[0];
    // A distinct large heading is a candidate; ordinary paragraphs are not.
    const sizes=firstPage.map(l=>l.size).filter(Boolean).sort((a,b)=>a-b);
    const body=sizes[Math.floor(sizes.length/2)]||10;
    if(best&&best.size>=body*1.12){
      const title=[best.text];titleEnd=best.i;
      for(let i=best.i+1;i<front.length&&title.length<3;i++){
        const l=front[i];if(Math.abs(l.size-best.size)>1||affiliation.test(l.text)||l.text.length<4)break;
        title.push(l.text);titleEnd=i;
      }
      put('title',title.join(' '),'首页标题候选（请核对）');
    }
  }else titleEnd=front.findIndex(l=>fields.title.toLowerCase().includes(l.text.toLowerCase())&&l.text.length>8);
  if(!fields.authors){
    const explicit=front.find(l=>/^(authors?|作者)\s*[:：]/i.test(l.text));
    if(explicit)put('authors',explicit.text.replace(/^(authors?|作者)\s*[:：]\s*/i,''),'首页作者行（请核对）');
    else if(titleEnd>=0){
      const candidates=[];
      for(const line of front.slice(titleEnd+1,titleEnd+4)){
        if(affiliation.test(line.text)||heading.test(line.text))break;
        const value=line.text.replace(/[\d*†‡⁎]+/g,'').trim();
        const names=value.split(/\s+and\s+|[,;，；、]/i).map(v=>v.trim()).filter(Boolean);
        const valid=names.length>0&&names.every(n=>/^[\u3400-\u9fff]{2,4}$/.test(n)||(/^[\p{L}][\p{L}.'’ -]+$/u.test(n)&&n.split(/\s+/).length>=2&&n.split(/\s+/).length<=5));
        if(!valid||/\b(a|the|of|for|with|using|based|approach|learning)\b/i.test(value))break;
        candidates.push(...names);
      }
      put('authors',candidates.join('; '),'首页作者候选（请核对）');
    }
  }
  const lines=pages.flat().slice(0,1200), text=lines.map(l=>l.text).join('\n');
  if(!fields.keywords){
    const index=lines.findIndex(l=>/^(key\s*words?|index terms|关\s*键\s*词)\s*[:：—–-]?/i.test(l.text));
    if(index>=0){
      const parts=[lines[index].text.replace(/^(key\s*words?|index terms|关\s*键\s*词)\s*[:：—–-]?\s*/i,'')];
      for(const next of lines.slice(index+1,index+4)){
        if(heading.test(next.text)||affiliation.test(next.text)||/^\d+[.\s]/.test(next.text)||/[.。]$/.test(parts.at(-1))||next.text.length>160||Math.abs(next.size-lines[index].size)>1.5)break;
        parts.push(next.text);
      }
      put('keywords',keywordText(parts.join(' ')),'首页关键词栏（请核对）');
    }
  }
  const beforeReferences=text.split(/\n(?:references|参考文献)\b/i)[0];
  const doi=clean(xmp['prism:doi']||xmp['pdfx:doi'])||beforeReferences.match(/\b10\.\d{4,9}\/[A-Z0-9._;()/:+-]+/i)?.[0];
  if(doi)put('doi',doi.replace(/[.,;]+$/,''),'PDF DOI（请核对）');
  const year=beforeReferences.match(/(?:©|copyright|published(?:\s+online)?|发表(?:日期)?|出版(?:日期)?)\s*[:：]?\s*(?:\d{1,2}\s+\w+\s+)?((?:19|20)\d{2})/i);
  if(year)put('year',year[1],'首页发表信息（请核对）');
  const status=Object.keys(fields).length?'recognized':text.trim().length<20?'no-text':'no-fields';
  return {fields,sources,status,message:status==='recognized'?'已识别部分题录，请核对后使用。':status==='no-text'?'未读到可提取文字，可能是扫描件；本版暂不支持 OCR。':'未找到可靠题录，请手动补充。'};
}

let active=0;
const unavailable=(status,message)=>({fields:{},sources:{},status,message});
export function extractMetadata(bytes,{timeoutMs=15000}={}){
  if(active>=2)return Promise.resolve(unavailable('busy','识别任务繁忙，PDF 已保留，请稍后点击“识别题录”。'));
  active++;
  return new Promise(resolve=>{
    let worker,timer,finished=false;
    const done=result=>{if(finished)return;finished=true;clearTimeout(timer);active--;if(worker)void worker.terminate();resolve(result);};
    try{
      worker=new Worker(new URL('./metadata-worker.mjs',import.meta.url),{workerData:{bytes:Uint8Array.from(bytes)},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256},stdout:true,stderr:true});
      worker.stdout.resume();worker.stderr.resume();
      timer=setTimeout(()=>done(unavailable('timeout','识别超时，PDF 已保留，可稍后重试或手动填写。')),timeoutMs);
      worker.once('message',done);
      worker.once('error',()=>done(unavailable('failed','题录识别失败，PDF 已保留，请手动填写或重试。')));
      worker.once('exit',()=>done(unavailable('failed','题录识别中断，PDF 已保留，可稍后重试。')));
    }catch{done(unavailable('failed','题录识别无法启动，请检查 Node.js 版本与依赖安装。'));}
  });
}
