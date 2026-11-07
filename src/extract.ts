import { parse } from 'parse5';

// Turn fetched pages and documents into plain text the agent can search and quote. Runs in the student's sandbox,
// never in the controller, because the content is untrusted.
type Node={nodeName:string;tagName?:string;attrs?:{name:string;value:string}[];childNodes?:Node[];value?:string;parentNode?:Node};
const SKIP=new Set(['script','style','noscript','template','svg','nav','aside','form','button','iframe','select','input','textarea','dialog','canvas','video','audio','object','embed','head']);
const BLOCK=new Set(['p','div','section','article','main','header','footer','li','ul','ol','dl','dt','dd','table','tr','h1','h2','h3','h4','h5','h6','blockquote','pre','figure','figcaption','address','details','summary','hr','br']);
// Links worth keeping inline: the ones a student needs to act on.
const USEFUL=/\.pdf(\?|#|$)|apply|applica|admission|admisi|tuition|matr[ií]cula|fee|cost|cuota|deadline|fecha|calendar|calendario|catalog|cat[aá]logo|form|formulario|aid|ayuda|scholarship|beca|requirement|requisito|nursing|enfermer/i;
const attr=(n:Node,name:string)=>n.attrs?.find(a=>a.name===name)?.value;
const squash=(s:string)=>s.replace(/[ \t\r\f\v ]+/g,' ').replace(/ *\n */g,'\n').trim();

export function decodeHtml(bytes:Uint8Array,charset?:string) {
  const head=new TextDecoder('latin1').decode(bytes.subarray(0,4096));
  const label=charset||head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]||'utf-8';
  try {return new TextDecoder(label).decode(bytes);} catch {return new TextDecoder('utf-8').decode(bytes);}
}
export function htmlToText(html:string,base:string) {
  const doc=parse(html) as unknown as Node;
  let title='';const find=(n:Node,test:(n:Node)=>boolean):Node|undefined=>{if(test(n))return n;for(const c of n.childNodes||[]){const f=find(c,test);if(f)return f;}};
  const t=find(doc,n=>n.tagName==='title');if(t)title=squash(textOf(t));
  const body=find(doc,n=>n.tagName==='body')||doc;
  const main=find(body,n=>n.tagName==='main'||attr(n,'role')==='main')||find(body,n=>n.tagName==='article');
  let text=render(main||body,base);
  if(main&&text.length<500)text=render(body,base);
  return {title,text};
}
function textOf(n:Node):string {return n.nodeName==='#text'?n.value||'':(n.childNodes||[]).map(textOf).join('');}
function render(root:Node,base:string) {
  const out:string[]=[];let line='';
  // Keep a nested list item's indent, which squash would trim.
  const flush=()=>{const indent=line.match(/^ +(?=- )/)?.[0]||'',s=squash(line);if(s)out.push(indent+s);line='';};
  // Site headers and footers are boilerplate unless they belong to the main content.
  const walk=(n:Node,depth:number,inside:boolean)=>{
    if(n.nodeName==='#text'){line+=n.value||'';return;}
    const tag=n.tagName;if(!tag){for(const c of n.childNodes||[])walk(c,depth,inside);return;}
    if(SKIP.has(tag)||attr(n,'hidden')!==undefined||attr(n,'aria-hidden')==='true'||(!inside&&(tag==='header'||tag==='footer')))return;
    if(tag==='br'){line+='\n';return;}
    if(tag==='table'){flush();out.push(...table(n,base));return;}
    const heading=/^h([1-6])$/.exec(tag);
    if(BLOCK.has(tag))flush();
    if(heading)line+='#'.repeat(Number(heading[1]))+' ';
    if(tag==='li')line+='  '.repeat(Math.max(0,depth-1))+'- ';
    if(tag==='img'){const alt=attr(n,'alt');if(alt?.trim())line+=` [image: ${alt.trim()}] `;return;}
    const before=line.length;
    for(const c of n.childNodes||[])walk(c,depth+(tag==='ul'||tag==='ol'?1:0),inside||tag==='main'||tag==='article');
    if(tag==='a'){const href=attr(n,'href');const label=squash(line.slice(before));
      if(href&&label&&(USEFUL.test(href)||USEFUL.test(label))){try{const u=new URL(href,base);if(/^https?:$/.test(u.protocol))line+=` (${u.href})`;}catch{}}}
    if(BLOCK.has(tag))flush();
  };
  walk(root,0,root.tagName==='main'||root.tagName==='article'||attr(root,'role')==='main');flush();
  return out.join('\n').replace(/\n{3,}/g,'\n\n');
}
function table(n:Node,base:string) {
  const rows:string[][]=[];let header=false;
  const collect=(x:Node)=>{
    if(x.tagName==='tr'){const cells=(x.childNodes||[]).filter(c=>c.tagName==='td'||c.tagName==='th');
      if(!rows.length&&cells.length&&cells.every(c=>c.tagName==='th'))header=true;
      rows.push(cells.map(c=>squash(render(c,base)).replace(/\n+/g,' ').replace(/\|/g,'/')));return;}
    if(x.tagName==='table'&&x!==n){rows.push([squash(render(x,base)).replace(/\n+/g,' ')]);return;}
    for(const c of x.childNodes||[])collect(c);
  };
  collect(n);
  const caption=(n.childNodes||[]).find(c=>c.tagName==='caption');
  const lines=caption?[`Table: ${squash(textOf(caption))}`]:[];
  rows.forEach((r,i)=>{lines.push(`| ${r.join(' | ')} |`);if(i===0&&header)lines.push(`|${r.map(()=>' --- ').join('|')}|`);});
  return lines;
}
export async function pdfToText(bytes:Uint8Array) {
  const {getDocumentProxy,extractText}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(bytes));
  const info=await pdf.getMetadata().catch(()=>undefined) as {info?:{Title?:string}}|undefined;
  const {totalPages,text}=await extractText(pdf,{mergePages:false});
  const pages=(text as string[]).map((page,i)=>{const clean=squash(page);return `## Page ${i+1}\n${clean.length<20?'[No selectable text on this page; it may be a scan. Ask the student for a photo or another copy if it matters.]':clean}`;});
  await pdf.cleanup().catch(()=>{});
  return {title:info?.info?.Title?.trim()||'',text:pages.join('\n\n'),pages:totalPages};
}
