import type { EntryRecord, LiveState } from '@earendil-works/pi-durable';

export type ActivityItem={id:string,kind:'student'|'assistant'|'tool',label:string,state:string,text:string,output?:string};
export type Activity={observedAt:string,state:string,items:ActivityItem[],truncated:boolean};
const textParts=(content:readonly {type:string;text?:string}[])=>content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n');

// Project only visible messages and tool activity, never model reasoning or runtime credentials.
export function activitySnapshot(entries:readonly EntryRecord[],live:Readonly<LiveState>,token:string,truncated=false):Activity {
  const clean=(value:string)=>{
    const redacted=value.replaceAll(token,'[credential redacted]').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
    return redacted.length>12000?'[Earlier output omitted]\n'+redacted.slice(-12000):redacted;
  };
  const items:ActivityItem[]=[],calls=new Map<string,ActivityItem>();
  for(const entry of entries)for(const [index,m] of (entry.model||[]).entries()) {
    const id=`${entry.id}:${index}`;
    if(m.role==='user')items.push({id,kind:'student',label:'Student',state:'received',text:clean((typeof m.content==='string'?m.content:textParts(m.content)).split('\n\n[Application persistence status]')[0])});
    if(m.role==='assistant') {
      const text=textParts(m.content);
      if(text||m.errorMessage)items.push({id,kind:'assistant',label:'Assistant',state:m.errorMessage?'error':'done',text:clean(text||m.errorMessage||'')});
      for(const p of m.content)if(p.type==='toolCall') {
        const item:ActivityItem={id:`${id}:${p.id}`,kind:'tool',label:p.name,state:'interrupted',text:clean(p.name==='bash'&&typeof p.arguments.command==='string'?p.arguments.command:JSON.stringify(p.arguments,null,2))};
        items.push(item);calls.set(p.id,item);
      }
    }
    if(m.role==='toolResult') {
      let item=calls.get(m.toolCallId);
      if(!item){item={id,kind:'tool',label:m.toolName,state:'done',text:'[Call predates recent history]'};items.push(item);calls.set(m.toolCallId,item);}
      item.state=m.isError?'error':'done';item.output=clean(textParts(m.content));
    }
  }
  for(const slot of live.tools||[]) {
    let item=calls.get(slot.callId);
    if(!item){item={id:`live:${slot.callId}`,kind:'tool',label:slot.name,state:slot.status,text:'[Call predates recent history]'};items.push(item);}
    if(slot.status!=='done'){item.state=slot.status;item.output=clean(slot.output||'');}
    if(slot.droppedBytes||slot.droppedLines)item.output='[Earlier live output omitted]\n'+(item.output||'');
  }
  const partial=live.generation?.message;
  if(partial){const text=textParts(partial.content);if(text)items.push({id:'generating',kind:'assistant',label:'Assistant',state:'generating',text:clean(text)});}
  const state=live.compactions?.some(c=>c.blocking)?'Compacting conversation':live.generation?.retry?'Waiting to retry model':live.tools?.some(t=>t.status==='running')?'Running tools':live.generation?'Generating response':live.run?'Working':'Idle';
  return {observedAt:new Date().toISOString(),state,items:items.slice(-100),truncated:truncated||items.length>100};
}
