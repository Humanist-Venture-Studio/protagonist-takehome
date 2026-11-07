export type ReplyKind='final'|'progress';
const STOP='Send /stop to cancel.';
export const REPLY_STYLE=`Write readable plain text for simulator. Do not use Markdown headings, bold/italic markers, code fences, tables, or Markdown links. Use ordinary punctuation, simple "- " bullets when useful, and plain URLs.
Aim for 400–600 Unicode characters when an explanation is needed; a shorter answer is welcome. Prefer at most 700 Unicode characters and 120 whitespace-separated words in a final reply. Use 2–4 short paragraphs, or one for a short answer, at most three simple "- " bullets, and at most one focused question. These are readability targets, never a reason to withhold a useful answer or tell the student it cannot fit. If you ask a question, request exactly one focused piece of information. Do not bundle several questions into one sentence or give a checklist of details the student must supply. Ask for the most useful next detail and wait for the answer.
Send one final message: give the concise answer and the useful next step or question. Put full plans, comparisons and lengthy details in an attachment, with a short chat summary; even when more detail is requested, keep the chat summary concise. Do not silently truncate essential content or divide an answer into consecutive messages to evade the limit.
Preserve essential meaning, explicit dates and URLs exactly when shortening. Phone-screen fit varies by device and text size; this content budget is a practical default, not a guarantee.
Progress updates must be at most 240 Unicode characters INCLUDING the exact ending "${STOP}". Use them only for progress during long work, never as additional pieces of the final answer.`;

const finalFallback='I couldn’t prepare that reply. Please try again.';
const progressFallback=`I couldn’t fit this update into a short message. I’ll include the result in my reply. ${STOP}`;
const escaped=(text:string,index:number)=>{
  let count=0;
  while(index>0&&text[--index]==='\\')count++;
  return count%2===1;
};
// Keep bracket balancing explicit; escaped punctuation belongs to the label/URL.
function balancedEnd(text:string,start:number,open:string,close:string) {
  let depth=1;
  for(let index=start+1;index<text.length;index++) {
    if(escaped(text,index))continue;
    if(text[index]===open)depth++;
    else if(text[index]===close&&--depth===0)return index;
  }
  return -1;
}
function links(text:string) {
  let result='';
  for(let index=0;index<text.length;) {
    const image=text[index]==='!'&&text[index+1]==='['&&!escaped(text,index);
    const start=image?index+1:index;
    if(text[start]!=='['||escaped(text,start)){result+=text[index++];continue;}
    const end=balancedEnd(text,start,'[',']');
    if(end<0||text[end+1]!=='('){result+=text[index++];continue;}
    const finish=balancedEnd(text,end+1,'(',')');
    if(finish<0){result+=text[index++];continue;}
    let destination=text.slice(end+2,finish).trim();
    if(destination.startsWith('<')&&destination.endsWith('>'))destination=destination.slice(1,-1);
    // Titles or whitespace in a destination are ambiguous: leave the complete
    // source for validation/rewrite instead of losing any of its content.
    if(!destination||/\s/.test(destination)){result+=text.slice(index,finish+1);index=finish+1;continue;}
    destination=destination.replace(/\\([\\()[\]])/g,'$1');
    const label=text.slice(start+1,end);
    result+=label===destination?destination:`${label||'Link'} (${destination})`;
    index=finish+1;
  }
  return result;
}
function protect(text:string) {
  let marker='\uE000';
  while(text.includes(marker))marker+='\uE000';
  const values:string[]=[];
  return {
    save:(value:string)=>`${marker}${values.push(value)-1}${marker}`,
    restore:(value:string)=>value.replace(new RegExp(`${marker}(\\d+)${marker}`,'g'),(_all,index)=>values[Number(index)]),
  };
}
function inline(text:string) {
  const tokens=protect(text);
  let value=links(text);
  value=value.replace(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/g,'$1');
  value=value.replace(/(?:https?:\/\/|mailto:)[^\s<>]+/g,url=>tokens.save(url));
  // Preserve escape provenance for punctuation that could become Markdown on a
  // second pass. Safe escapes lose their slash; ambiguous literal markers keep it.
  value=value.replace(/\\([\\`*_[\]#~|])/g,part=>tokens.save(part));
  value=value.replace(/\\([.!?()+{}-])/g,'$1');
  value=value.replace(/(`+)([^`\n]+)\1/g,(all,_ticks,body:string)=>{
    return inline(body)!==body?tokens.save(all):tokens.save(body);
  });
  for(const delimiter of ['***','___','**','__','*','_']) {
    const mark=delimiter.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const character=delimiter[0]==='*'?'\\*':'_';
    const pattern=new RegExp(`(^|[^\\p{L}\\p{N}\\\\${character}])${mark}(?!${character})(?=\\S)([^\\n]+?\\S|\\S)(?<!${character})${mark}(?![\\p{L}\\p{N}${character}])`,'gu');
    value=value.replace(pattern,'$1$2');
  }
  return tokens.restore(value);
}
function cells(line:string) {
  const result:string[]=[];
  let current='',code=false;
  for(let index=0;index<line.length;index++) {
    const char=line[index];
    if(char==='`'&&!escaped(line,index))code=!code;
    if(char==='|'&&!escaped(line,index)&&!code){result.push(current.trim());current='';}
    else current+=char;
  }
  result.push(current.trim());
  if(result[0]==='')result.shift();
  if(result.at(-1)==='')result.pop();
  return result;
}
function tables(lines:string[]) {
  const result:string[]=[];
  for(let index=0;index<lines.length;index++) {
    const headings=cells(lines[index]),separator=index+1<lines.length?cells(lines[index+1]):[];
    if(!lines[index].includes('|')||separator.length!==headings.length||!separator.every(cell=>/^:?-{3,}:?$/.test(cell))) {
      result.push(lines[index]);continue;
    }
    const rows:string[][]=[];
    let end=index+2;
    while(end<lines.length&&lines[end].includes('|')&&lines[end].trim())rows.push(cells(lines[end++]));
    if(!rows.length||rows.some(row=>row.length!==headings.length)) {
      result.push(...lines.slice(index,end));index=end-1;continue;
    }
    for(const row of rows)result.push('- '+row.map((value,column)=>`${headings[column]}: ${value}`).join('; '));
    index=end-1;
  }
  return result;
}

/** Normalize unambiguous Markdown without cutting content. Ambiguous markup is
 * retained so replyProblem can request a rewrite from the full original. */
export function plainText(text:string):string {
  const blocks=protect(text);
  let lines=text.replace(/\r\n?/g,'\n').split('\n');
  const unfenced:string[]=[];
  for(let index=0;index<lines.length;index++) {
    const fence=lines[index].match(/^\s*(`{3,}|~{3,})[^\s]*\s*$/);
    if(!fence){unfenced.push(lines[index]);continue;}
    const end=lines.findIndex((line,next)=>next>index&&new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(line));
    if(end<0){unfenced.push(blocks.save(lines.slice(index).join('\n')));break;}
    const body=lines.slice(index+1,end);
    if(body.some(line=>inline(line)!==line))unfenced.push(blocks.save(lines.slice(index,end+1).join('\n')));
    else unfenced.push(...body);
    index=end;
  }
  lines=tables(unfenced);
  return blocks.restore(lines.map(line=>{
    const heading=line.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if(heading)line=heading[1];
    if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line))return '';
    line=line.replace(/^\s*[*+•][ \t]+/,'- ');
    line=line.replace(/^\s*(\d+[.)])[ \t]+/,'- $1 ');
    return inline(line).trimEnd();
  }).join('\n').replace(/\n{3,}/g,'\n\n').trim());
}

function withoutLiterals(text:string) {
  return text.replace(/(?:https?:\/\/|mailto:)[^\s<>]+/g,'URL').replace(/\\[\\`*_[\]#~|]/g,'');
}
// Stay below simulator’s 4096-character ceiling, counting UTF-16 conservatively.
// Keeping the former 3900-unit unsplit boundary also makes legacy sent receipts
// unambiguous. We send plain text, no parse_mode.
export function deliveryProblem(text:string):string|null {
  if(!text.trim())return 'The reply is empty.';
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return 'The reply contains unsupported control characters.';
  if(text.length>3900)return 'The reply exceeds the single-message delivery limit.';
  return null;
}
const withinFinalTarget=(text:string)=>[...text].length<=700&&text.trim().split(/\s+/u).length<=120;
/** Style diagnostics, not final-message delivery blockers. Progress remains strict. */
export function replyProblem(text:string,kind:ReplyKind):string|null {
  if(!text.trim())return 'The reply is empty.';
  if([...text].length>(kind==='progress'?240:700))return 'The reply exceeds the character budget.';
  if(text.trim().split(/\s+/u).length>120)return 'The reply exceeds 120 words.';
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return 'The reply contains unsupported control characters.';
  const content=withoutLiterals(text);
  if((content.match(/[?؟？]/gu)||[]).length>1)return 'Use at most one focused question.';
  // Catch obvious bundles with one closing question mark. This deliberately
  // complements the response instructions; it is not a semantic question parser.
  const questions=content.match(/[^.!?؟？]*[?؟？]/gu)||[];
  if(questions.some(question=>/(?<![\p{L}\p{N}_])(?:and\s+(?:what|which|where|when|how|who)|y\s+(?:qué|cuál(?:es)?|dónde|cuándo|cómo))(?![\p{L}\p{N}_])/iu.test(question)))
    return 'Ask for one focused piece of information, without bundling questions.';
  if((text.match(/^ *- /gm)||[]).length>3)return 'Use at most three bullets.';
  if(text.trim().split(/\n[ \t]*\n/).length>4)return 'Use at most four short paragraphs.';
  if(/`|^\s*(?:#{1,6}\s|>\s|[*+]\s|\d+[.)]\s)|\[[^\n]*\]\s*[\[(]|<\/?[a-z][^>]*>|^\s*\|.*\|\s*$|^\s*~{3,}|^ *- \[[ x]\]/im.test(content))
    return 'The reply contains unsupported or ambiguous markup.';
  if(/(^|[^\p{L}\p{N}*_])(?:\*{1,3}|_{1,3})(?![*_])(?=\S)|(?<=\S)(?<![*_])(?:\*{2,3}|_{2,3})(?![*_])(?=$|[^\p{L}\p{N}])|~~\S/um.test(content))
    return 'The reply contains unsupported or ambiguous emphasis.';
  if(kind==='progress'&&(!text.endsWith(STOP)||text===STOP))return 'A progress update must end with the stop instruction.';
  return null;
}
function prepare(text:string,kind:ReplyKind) {
  const normalized=plainText(text);
  if(kind==='final')return normalized;
  const body=normalized.replace(/(?:\s*Send \/stop to cancel\.)+\s*$/u,'').trimEnd();
  return body?`${body} ${STOP}`:STOP;
}
function essentialLiterals(text:string) {
  const urls=(text.match(/(?:https?:\/\/|mailto:)[^\s<>]+/g)||[]).map(value=>{
    value=value.replace(/[.,;:!?]+$/,'');
    for(const [open,close] of [['(',')'],['[',']'],['{','}']]) {
      while(value.endsWith(close)&&value.split(close).length>value.split(open).length)value=value.slice(0,-1);
    }
    return value;
  });
  const month='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
  const spanish='(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)';
  const dates=text.match(new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,4}[/.]\\d{1,2}[/.]\\d{2,4}|${month}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${month}(?:\\s+\\d{4})?|\\d{1,2}\\s+de\\s+${spanish}(?:\\s+de\\s+\\d{4})?)\\b`,'gi'))||[];
  return [...new Set([...urls,...dates])];
}
/** One bounded shortening attempt for a fresh long answer. A usable original
 * survives rewrite failure; saved replies skip shortening on delivery retries.
 * The callback always receives the full original, never a clipped intermediate. */
export async function approveReply(text:string,kind:ReplyKind,rewrite:(text:string,kind:ReplyKind)=>Promise<string>,options:{prepared?:boolean}={}):Promise<{text:string;fallback:boolean}> {
  if(kind==='final'&&options.prepared&&!deliveryProblem(text))return {text,fallback:false};
  const formatted=prepare(text,kind);
  const deliverable=!deliveryProblem(formatted);
  if(kind==='final') {
    // Empty/unsafe input cannot be repaired by asking a model to invent an answer.
    if(!formatted.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(formatted))return {text:finalFallback,fallback:true};
    if(deliverable&&withinFinalTarget(formatted))return {text:formatted,fallback:false};
  } else if(!replyProblem(formatted,kind))return {text:formatted,fallback:false};
  try {
    const changed=await rewrite(text,kind);
    if(typeof changed==='string') {
      const rewritten=prepare(changed,kind);
      const acceptable=kind==='final'?!deliveryProblem(rewritten)&&rewritten.length<=formatted.length:!replyProblem(rewritten,kind);
      if(acceptable&&essentialLiterals(formatted).every(value=>rewritten.includes(value)))
        return {text:rewritten,fallback:false};
    }
  }catch {}
  if(kind==='final'&&deliverable)return {text:formatted,fallback:false};
  return {text:kind==='progress'?progressFallback:finalFallback,fallback:true};
}
