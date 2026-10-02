const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const id=params.get('id'),token=params.get('token');
const zooms=new Set(['width','0.5','0.75','1','1.25','1.5','2']);
let pdf,loadingTask,renderTask,textTask,lib,current=1,zoom='width',generation=0,started=false;
const notify=(type,details={})=>parent.postMessage({type,id,...details},location.origin);
function controls(){
  $('pageNumber').disabled=$('zoom').disabled=!pdf;
  $('previous').disabled=!pdf||current<=1;$('next').disabled=!pdf||current>=pdf.numPages;
  $('pageNumber').value=current;if(pdf){$('pageNumber').max=pdf.numPages;$('pageTotal').textContent=pdf.numPages;}
}
function showError(message){
  $('status').textContent='无法完成 PDF 阅读';$('error').textContent=message+' 可以使用主界面右上角“打开 PDF ↗”继续阅读。';$('error').hidden=false;
  notify('reader-error');
}
async function render(){
  if(!pdf)return;const version=++generation;renderTask?.cancel();textTask?.cancel();
  notify('reader-busy');$('status').textContent=`正在渲染第 ${current} 页…`;$('error').hidden=true;controls();
  try{
    const page=await pdf.getPage(current);if(version!==generation)return;
    const base=page.getViewport({scale:1});
    const width=Math.max(80,$('viewport').clientWidth-26);
    // Bound very large page canvases while retaining the requested CSS size.
    const scale=zoom==='width'?Math.max(.1,Math.min(3,width/base.width)):Number(zoom);
    const viewport=page.getViewport({scale});
    if(viewport.width>20000||viewport.height>20000)throw Error('页面尺寸过大，请尝试更小的缩放比例。');
    const pixels=Math.min(devicePixelRatio||1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(viewport.width*pixels));canvas.height=Math.max(1,Math.floor(viewport.height*pixels));canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    canvas.setAttribute('aria-label',`第 ${current} 页`);
    const layer=document.createElement('div');layer.className='textLayer';layer.style.setProperty('--total-scale-factor',scale);
    renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[pixels,0,0,pixels,0,0]});
    await renderTask.promise;if(version!==generation)return;
    const content=await page.getTextContent();if(version!==generation)return;
    textTask=new lib.TextLayer({textContentSource:content,container:layer,viewport});
    // Attach before text layout for accurate font measurements.
    const sheet=$('sheet');sheet.style.width=viewport.width+'px';sheet.style.height=viewport.height+'px';sheet.style.setProperty('--total-scale-factor',scale);sheet.replaceChildren(canvas,layer);
    let textWarning=false;
    try{await textTask.render();}catch(error){if(error.name!=='AbortException')textWarning=true;}
    if(version!==generation)return;
    $('viewport').scrollTop=0;$('viewport').scrollLeft=0;
    $('status').textContent=`第 ${current} / ${pdf.numPages} 页 · ${Math.round(scale*100)}%${textWarning?' · 本页文字选择不可用':''}`;
    notify('reader-progress',{page:current,total:pdf.numPages,zoom});
  }catch(error){if(version!==generation||['RenderingCancelledException','AbortException'].includes(error.name))return;showError('本页解析失败，请尝试其他页或在浏览器中打开 PDF。');}
}
async function start(progress){
  if(started)return;started=true;
  if(!/^[a-f0-9-]{36}$/.test(id||'')||!token){showError('阅读地址无效，请从文献列表重新打开。');return;}
  try{
    lib=await import('/pdf-assets/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/pdf-assets/pdf.worker.mjs';
    loadingTask=lib.getDocument({url:`/api/papers/${id}/file`,httpHeaders:{'X-PaperDesk-Token':token},isEvalSupported:false,useWasm:false,wasmUrl:'/pdf-assets/wasm/',enableXfa:false,verbosity:0,cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/'});
    pdf=await loadingTask.promise;
    current=Number.isSafeInteger(progress?.page)?Math.max(1,Math.min(pdf.numPages,progress.page)):1;
    zoom=zooms.has(progress?.zoom)?progress.zoom:'width';$('zoom').value=zoom;controls();await render();
  }catch(error){showError(error.name==='PasswordException'?'PDF 受密码保护，请使用浏览器阅读器输入密码。':'PDF 或阅读器组件无法载入。请检查文件是否损坏，以及是否已运行 npm ci 安装依赖。');}
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.id!==id)return;
  if(event.data.type==='reader-init')void start(event.data.progress);
  if(event.data.type==='reader-jump'&&pdf&&Number.isSafeInteger(event.data.page)&&event.data.page>=1&&event.data.page<=pdf.numPages){current=event.data.page;void render();}
});
$('fullscreen').hidden=!document.fullscreenEnabled;
$('fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{$('status').textContent='浏览器未允许全屏，请使用主界面的宽屏阅读。';}
};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏 PDF';});
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&parent!==window){event.preventDefault();notify('reader-save');return;}
  if(event.key==='Escape'&&!document.fullscreenElement){notify('reader-exit-wide');return;}
  if(event.target.closest('input,select,textarea,button')||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(event.key==='ArrowLeft'&&pdf&&current>1){event.preventDefault();current--;void render();}
  if(event.key==='ArrowRight'&&pdf&&current<pdf.numPages){event.preventDefault();current++;void render();}
});
$('previous').onclick=()=>{if(pdf&&current>1){current--;void render();}};
$('next').onclick=()=>{if(pdf&&current<pdf.numPages){current++;void render();}};
function jump(){if(!pdf)return;const value=Number($('pageNumber').value);if(Number.isSafeInteger(value)&&value>=1&&value<=pdf.numPages){current=value;void render();}else{$('pageNumber').value=current;$('status').textContent=`请输入 1 至 ${pdf.numPages} 的页码。`;}}
$('pageNumber').onchange=jump;$('pageNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();jump();}};
$('zoom').onchange=()=>{zoom=$('zoom').value;void render();};
let resizeTimer,lastWidth=0;new ResizeObserver(()=>{const width=$('viewport').clientWidth;if(!width||width===lastWidth)return;lastWidth=width;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(pdf&&zoom==='width')void render();},120);}).observe($('viewport'));
window.addEventListener('pagehide',()=>{generation++;clearTimeout(resizeTimer);renderTask?.cancel();textTask?.cancel();void loadingTask?.destroy();});
notify('reader-ready');
// A standalone reader URL still works without the parent application.
if(parent===window)void start(null);
