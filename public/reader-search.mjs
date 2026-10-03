// Keep original UTF-16 offsets when case folding or expanding PDF ligatures.
function normalize(text,withOffsets=false){
  let value='',offset=0;const starts=[],ends=[];
  for(const char of text){
    const next=offset+char.length;
    for(const part of char.normalize('NFKC').toLowerCase()){
      if(/\s/u.test(part)){
        if(value.endsWith(' ')){if(withOffsets)ends[ends.length-1]=next;continue;}
        value+=' ';if(withOffsets){starts.push(offset);ends.push(next);}
      }else{
        value+=part;
        if(withOffsets)for(let i=0;i<part.length;i++){starts.push(offset);ends.push(next);}
      }
    }
    offset=next;
  }
  return {value,starts,ends};
}

export function findTextMatches(text,query,limit=500){
  const needle=normalize(query).value.trim();
  if(!needle)return {matches:[],limited:false};
  const {value,starts,ends}=normalize(text,true),matches=[];
  let from=0,position;
  while((position=value.indexOf(needle,from))!==-1){
    const match={start:starts[position],end:ends[position+needle.length-1]};
    from=position+needle.length;
    if(matches.at(-1)?.end>match.start)continue;
    if(matches.length>=limit)return {matches,limited:true};
    matches.push(match);
  }
  return {matches,limited:false};
}

export class PageSearch{
  constructor(doc){
    this.doc=doc;this.$=id=>doc.getElementById(id);this.ranges=[];this.active=0;this.layer=null;
    this.$('pageSearch').addEventListener('submit',event=>{event.preventDefault();this.move(event.submitter?.id==='findPrevious'?-1:1);});
    this.$('findQuery').addEventListener('input',event=>{if(!event.isComposing)this.search(true);});
    this.$('findQuery').addEventListener('compositionend',()=>this.search(true));
    this.$('findQuery').addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.isComposing){event.preventDefault();this.move(event.shiftKey?-1:1);}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.$('findQuery').value='';this.search(false);this.$('viewport').focus();}
    });
    this.$('clearFind').onclick=()=>{this.$('findQuery').value='';this.search(false);this.$('findQuery').focus();};
  }
  setLayer(layer){this.layer=layer;this.search(false);}
  clear(){this.layer=null;this.ranges=[];this.active=0;this.paint();}
  focus(){this.$('findQuery').focus();this.$('findQuery').select();}
  search(scroll){
    this.ranges=[];this.active=0;this.limited=false;
    if(this.layer){
      const segments=[];let text='';
      const walker=this.doc.createTreeWalker(this.layer,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
      for(let node;(node=walker.nextNode());){
        if(node.nodeType===3){segments.push({node,start:text.length,end:text.length+node.length});text+=node.data;}
        else if(node.nodeName==='BR')text+='\n';
      }
      this.hasText=!!text.trim();
      const result=findTextMatches(text,this.$('findQuery').value);this.limited=result.limited;
      for(const match of result.matches){
        const first=segments.find(s=>s.end>match.start),last=segments.find(s=>s.end>=match.end);
        if(!first||!last)continue;
        const range=this.doc.createRange();range.setStart(first.node,Math.max(0,match.start-first.start));range.setEnd(last.node,match.end-last.start);this.ranges.push(range);
      }
    }
    this.paint();if(scroll)this.scrollToActive();
  }
  move(delta){if(!this.ranges.length)return;this.active=(this.active+delta+this.ranges.length)%this.ranges.length;this.paint();this.scrollToActive();}
  paint(){
    const marks=this.$('searchMarks');marks.replaceChildren();
    const sheet=this.$('sheet').getBoundingClientRect();
    this.ranges.forEach((range,i)=>{
      for(const rect of range.getClientRects()){
        if(!rect.width||!rect.height)continue;
        const mark=this.doc.createElement('div');mark.className=i===this.active?'search-mark active':'search-mark';
        Object.assign(mark.style,{left:`${rect.left-sheet.left}px`,top:`${rect.top-sheet.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});marks.append(mark);
      }
    });
    this.$('findPrevious').disabled=this.$('findNext').disabled=!this.ranges.length;
    this.$('findCount').textContent=!this.layer?'等待本页载入':!this.hasText?'本页无可检索文字':!this.$('findQuery').value.trim()?'仅查找当前页':this.ranges.length?`${this.active+1} / ${this.ranges.length}${this.limited?'（仅显示前 500 处）':''}`:'本页未找到';
  }
  scrollToActive(){
    const rect=this.ranges[this.active]?.getBoundingClientRect();if(!rect)return;
    const viewport=this.$('viewport'),bounds=viewport.getBoundingClientRect();
    viewport.scrollTop+=rect.top-bounds.top-viewport.clientHeight/3;
    viewport.scrollLeft+=rect.left-bounds.left-viewport.clientWidth/3;
  }
}
