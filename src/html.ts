import { parse } from 'parse5';

// Documents a student downloads must be passive: nothing that runs, loads from the network, submits, or redirects.
// Parsed with a spec-compliant HTML parser, so the check sees the same tree a browser builds.
export const MAX_HTML_BYTES=5*1024*1024;
export const HTML_FILE=/\.(html?|xhtml?|xht)$/i, ACTIVE_FILE=/\.(svgz?|mhtml?|shtml|xml|xsl|js|mjs|hta)$/i;
const BLOCKED=new Set(['script','iframe','frame','frameset','object','embed','applet','form','input','textarea','select','base','link','portal',
  'audio','video','source','track','foreignobject','animate','set','animatemotion','animatetransform','discard','handler','listener']);
const IMAGE=/^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]*$/i, LINK=/^(https?:|mailto:|tel:|#)/i;
// CSS may only use embedded resources.
const cssProblem=(css:string)=>{
  // Decode CSS escapes first: to a browser, u\72l( is url(.
  const text=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff)||0xfffd)).replace(/\\(.)/gs,'$1');
  if(/@import/i.test(text))return 'CSS @import is not allowed';
  if(/expression\s*\(|behavior\s*:|-moz-binding|javascript:/i.test(text))return 'CSS must not contain scripts';
  for(const m of text.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi))if(!/^data:(font\/|image\/(png|jpeg|gif|webp|avif))/i.test(m[2].trim()))return `CSS url(${m[2].slice(0,60)}) must be an embedded data: URI`;
  return undefined;
};
type Node={nodeName:string;tagName?:string;attrs?:{name:string;value:string}[];childNodes?:Node[];content?:Node;value?:string};
export function htmlProblems(html:string):string[] {
  const problems=new Set<string>();
  if(Buffer.byteLength(html)>MAX_HTML_BYTES)return ['HTML documents must be 5 MB or smaller'];
  const doc=parse(html) as unknown as Node;
  if(!doc.childNodes?.some(n=>n.nodeName==='#documentType'))problems.add('Start with <!doctype html>');
  let h1=0,title='',charset=false,viewport=false,lang='';
  const text=(n:Node):string=>n.nodeName==='#text'?n.value||'':(n.childNodes||[]).map(text).join('');
  const walk=(n:Node)=>{
    const tag=(n.tagName||'').toLowerCase(),attrs=n.attrs||[],attr=(name:string)=>attrs.find(a=>a.name===name)?.value;
    if(tag) {
      if(BLOCKED.has(tag))problems.add(`<${tag}> is not allowed in a document`);
      if(tag==='html')lang=attr('lang')||'';
      if(tag==='h1')h1++;
      if(tag==='title')title=text(n).trim();
      if(tag==='meta') {
        if(attr('http-equiv')!==undefined)problems.add('<meta http-equiv> is not allowed');
        if((attr('charset')||'').toLowerCase()==='utf-8')charset=true;
        if(attr('name')==='viewport')viewport=true;
      }
      if(tag==='style'){const p=cssProblem(text(n));if(p)problems.add(p);}
      for(const {name,value} of attrs) {
        const key=name.toLowerCase(),v=value.trim();
        if(key.startsWith('on'))problems.add(`Event handler attributes such as ${key} are not allowed`);
        else if(key==='style'){const p=cssProblem(v);if(p)problems.add(p);}
        else if(key==='href'||key==='xlink:href') {
          if(tag==='a'||tag==='area'){if(!LINK.test(v))problems.add(`Links must be https, http, mailto, tel or #anchors (found "${v.slice(0,60)}")`);}
          else if(tag==='image'){if(!IMAGE.test(v))problems.add('SVG images must be embedded data:image URIs');}
          else if(!v.startsWith('#'))problems.add(`<${tag} ${key}> may only point inside the document`);
        }
        else if(key==='src'){if(tag!=='img'||!IMAGE.test(v))problems.add(`Images must be embedded data:image URIs (png, jpeg, gif, webp, avif), not "${v.slice(0,60)}"`);}
        else if(['srcset','srcdoc','action','formaction','poster','background','data','codebase','manifest','ping','longdesc','dynsrc','lowsrc'].includes(key))problems.add(`The ${key} attribute is not allowed`);
      }
    }
    for(const child of n.childNodes||[])walk(child);
    if(n.content)walk(n.content);
  };
  walk(doc);
  if(!lang)problems.add('Set the document language, for example <html lang="en">');
  if(!charset)problems.add('Add <meta charset="utf-8">');
  if(!viewport)problems.add('Add <meta name="viewport" content="width=device-width, initial-scale=1">');
  if(!title)problems.add('Add a <title>');
  if(h1!==1)problems.add(`Use exactly one <h1> (found ${h1})`);
  return [...problems].slice(0,12);
}
// The broker's reason for refusing a file a student would open in a browser, if any.
export function documentProblem(name:string,bytes:Buffer):string|undefined {
  if(ACTIVE_FILE.test(name))return 'This file type can run code in a browser. Send HTML (checked), PDF, an image, or plain text instead.';
  const head=bytes.subarray(0,512).toString('utf8').trimStart().toLowerCase();
  if(!HTML_FILE.test(name)&&!head.startsWith('<!doctype html')&&!head.startsWith('<html'))return undefined;
  const problems=htmlProblems(bytes.toString('utf8'));
  return problems.length?`HTML not accepted: ${problems.join('; ')}.`:undefined;
}
