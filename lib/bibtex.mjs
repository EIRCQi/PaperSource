// Plain-text metadata is escaped instead of interpreted as LaTeX commands.
function tex(value) {
  const escapes={'\\':'{\\textbackslash{}}','{':'{\\textbraceleft{}}','}':'{\\textbraceright{}}','%':'\\%','&':'\\&','_':'\\_','$':'\\$','#':'\\#','~':'{\\textasciitilde{}}','^':'{\\textasciicircum{}}'};
  return String(value).replace(/[\\{}%&_$#~^]/g,c=>escapes[c]).replace(/[\r\n\t]+/g,' ');
}

export function toBibtex(papers) {
  return papers.filter(p=>!p.trashed).map(p=>{
    const fields={title:'{'+tex(p.title)+'}',author:p.authors.split(/[;；]/).map(s=>s.trim()).filter(Boolean).map(tex).join(' and '),year:tex(p.year),journal:tex(p.journal),doi:tex(p.doi),keywords:tex([p.keywords,...p.tags].filter(Boolean).join(', '))};
    // The current catalog has no publication-type field; do not guess a type.
    const lines=Object.entries(fields).filter(([,v])=>v).map(([k,v])=>`  ${k} = {${v}}`);
    return `@misc{paper_${p.id.replaceAll('-','')},\n${lines.join(',\n')}\n}`;
  }).join('\n\n')+'\n';
}
