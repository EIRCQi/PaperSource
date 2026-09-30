import {deflateSync} from 'node:zlib';
// A real cross-reference table, compressed text stream, and UTF-16 PDF Info strings.
export function samplePdf({info={},lines=[
  ['Local Research Methods',20],['Alice Chen, Bob Li',12],['Example University',10],
  ['Abstract',12],['A study of robust local libraries.',10],
  ['Keywords: deep learning; local search.',10],['Published 2025',10],['doi:10.1234/example.2025',10],
]}={}){
  const escape=s=>s.replace(/[\\()]/g,'\\$&');
  const hex=s=>Buffer.from('\ufeff'+s,'utf16le').swap16().toString('hex');
  const content=lines.map(([line,size],i)=>`BT /F1 ${size} Tf 50 ${760-i*30} Td (${escape(line)}) Tj ET`).join('\n');
  const compressed=deflateSync(content);
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),compressed,Buffer.from('\nendstream')]),
    '<< '+Object.entries(info).map(([k,v])=>`/${k} <${hex(v)}>`).join(' ')+' >>',
  ];
  const parts=[Buffer.from('%PDF-1.7\n')],offsets=[0];let offset=parts[0].length;
  objects.forEach((body,i)=>{offsets.push(offset);const bytes=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),Buffer.from(body),Buffer.from('\nendobj\n')]);parts.push(bytes);offset+=bytes.length;});
  parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}
