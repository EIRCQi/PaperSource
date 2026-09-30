import {parentPort,workerData} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {inferMetadata,textLines} from './metadata.mjs';
let task;
try{
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<13))throw Object.assign(Error('Node version'),{code:'OLD_NODE'});
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets=new URL('../node_modules/pdfjs-dist/',import.meta.url);
  task=getDocument({data:workerData.bytes,verbosity:0,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,
    cMapUrl:fileURLToPath(new URL('cmaps/',assets)),cMapPacked:true,
    standardFontDataUrl:fileURLToPath(new URL('standard_fonts/',assets)),useWasm:false});
  const doc=await task.promise;
  const {info,metadata}=await doc.getMetadata();
  const xmp=metadata?Object.fromEntries(metadata):{};
  const pages=[];
  let warning='';
  for(let i=1;i<=Math.min(doc.numPages,2);i++){
    try{
      const page=await doc.getPage(i);
      const content=await page.getTextContent();
      pages.push(textLines(content.items.slice(0,20000)));page.cleanup();
    }catch{warning=' 部分页面文字无法读取。';}
  }
  const result=inferMetadata({info,xmp,pages});result.message+=warning;
  parentPort.postMessage(result);
}catch(error){
  const missing=error.code==='ERR_MODULE_NOT_FOUND';
  parentPort.postMessage({fields:{},sources:{},status:missing||error.code==='OLD_NODE'?'unavailable':error.name==='PasswordException'?'password':'failed',
    message:error.code==='OLD_NODE'?'自动识别需要 Node.js 22.13 或更高版本，请升级后重试。':missing?'自动识别依赖未安装，请关闭程序，在项目目录运行 npm ci 后重启。':error.name==='PasswordException'?'PDF 受密码保护，请手动填写题录。':'PDF 题录无法解析，请手动填写；文件仍可保留。'});
}finally{if(task)await task.destroy().catch(()=>{});}
