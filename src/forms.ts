import pdfLib from 'pdf-lib';

// Standard fillable PDF forms (AcroForm). The model decides what goes where; this fills it deterministically and checks.
const {PDFDocument,PDFName,PDFDict,PDFTextField,PDFCheckBox,PDFRadioGroup,PDFDropdown,PDFOptionList,PDFSignature,StandardFonts}=pdfLib;
type Doc=Awaited<ReturnType<typeof PDFDocument.load>>;
type Field=ReturnType<ReturnType<Doc['getForm']>['getFields']>[number];
export type FormField={name:string;label:string;nearby?:string;type:string;page:number|null;box?:[number,number,number,number];value:string|boolean|string[]|null;options?:string[];required:boolean;readOnly:boolean;maxLength?:number};
export type FormInfo={supported:boolean;reason?:string;xfa:'none'|'hybrid'|'dynamic';pages:number;fields:FormField[]};
export type Value=string|boolean|string[];

async function open(bytes:Uint8Array):Promise<{doc?:Doc;reason?:string;xfa:FormInfo['xfa']}> {
  let doc:Doc;
  try {doc=await PDFDocument.load(bytes,{updateMetadata:false});}
  catch(error) {return {reason:/encrypt/i.test(String((error as Error).message))?'The PDF is encrypted or password-protected; ask for an unlocked copy or the official fillable version.':'The file could not be read as a PDF.',xfa:'none'};}
  // Check for XFA before getForm(), which silently strips it.
  const acro=doc.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict);
  const hasXfa=!!acro?.get(PDFName.of('XFA'));
  const fields=(acro?.lookup(PDFName.of('Fields')) as {size?:()=>number}|undefined)?.size?.()||0;
  const xfa=!hasXfa?'none':fields?'hybrid':'dynamic';
  if(xfa==='dynamic')return {reason:'This is an XFA form, which only Adobe Reader can fill. Look for a standard fillable version, or prepare an answer sheet instead.',xfa};
  return {doc,xfa};
}
const typeOf=(f:Field)=>f instanceof PDFTextField?'text':f instanceof PDFCheckBox?'checkbox':f instanceof PDFRadioGroup?'radio':f instanceof PDFDropdown?'dropdown':f instanceof PDFOptionList?'list':f instanceof PDFSignature?'signature':'button';
function describe(doc:Doc,f:Field):FormField {
  const tu=f.acroField.dict.lookup(PDFName.of('TU')) as {decodeText?:()=>string}|undefined;
  const widget=f.acroField.getWidgets()[0],pageRef=widget?.P();
  const page=pageRef?doc.getPages().findIndex(p=>p.ref===pageRef):-1;
  const r=widget?.getRectangle(),box=r?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] as [number,number,number,number]:undefined;
  const base={name:f.getName(),label:(tu?.decodeText?.()||'').replace(/\s+/g,' ').trim()||f.getName(),type:typeOf(f),page:page>=0?page+1:null,box,required:f.isRequired(),readOnly:f.isReadOnly()};
  if(f instanceof PDFTextField){const max=f.getMaxLength();return {...base,value:f.getText()??null,...(max!==undefined?{maxLength:max}:{})};}
  if(f instanceof PDFCheckBox)return {...base,value:f.isChecked()};
  if(f instanceof PDFRadioGroup)return {...base,value:f.getSelected()??null,options:f.getOptions()};
  if(f instanceof PDFDropdown||f instanceof PDFOptionList)return {...base,value:f.getSelected(),options:f.getOptions()};
  if(f instanceof PDFSignature)return {...base,value:f.acroField.dict.get(PDFName.of('V'))?'signed':null};
  return {...base,value:null};
}
// The printed words beside or just above a field: the label a person would read, for forms whose fields lack tooltips.
async function nearby(bytes:Uint8Array,fields:FormField[]) {
  const {getDocumentProxy}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(bytes)),pages=new Map<number,{str:string;x:number;y:number;w:number}[]>();
  try {
    for(const f of fields) {
      if(!f.page||!f.box)continue;
      if(!pages.has(f.page)){const content=await pdf.getPage(f.page).then(p=>p.getTextContent());pages.set(f.page,(content.items as {str?:string;transform?:number[];width?:number}[]).filter(i=>i.str?.trim()&&i.transform).map(i=>({str:i.str!.trim(),x:i.transform![4],y:i.transform![5],w:i.width||0})));}
      const [x,y,w,h]=f.box,box=f.type==='checkbox'||f.type==='radio';
      const close=pages.get(f.page)!.map(t=>{
        const above=t.y>=y+h-2&&t.y<=y+h+14&&t.x<x+w&&t.x+t.w>x-4;        // a caption line just above the box
        const left=Math.abs(t.y-y-h/2)<=h/2+3&&t.x+t.w<=x+4&&t.x+t.w>=x-220; // a label on the same line, to the left
        // Checkboxes and radio buttons are usually labelled on the right.
        const right=box&&Math.abs(t.y-y-h/2)<=h/2+3&&t.x>=x+w-2&&t.x<=x+w+30;
        if(right)return {t,d:-10+(t.x-(x+w))/10};
        return !box&&(above||left)?{t,d:above?(t.y-(y+h))+Math.abs(t.x-x)/50:(x-(t.x+t.w))/10}:undefined;
      }).filter(Boolean) as {t:{str:string;x:number;y:number};d:number}[];
      const best=close.sort((a,b)=>a.d-b.d).slice(0,box?1:4).map(c=>c.t).sort((a,b)=>b.y-a.y||a.x-b.x);
      if(best.length)f.nearby=best.map(t=>t.str).join(' ').replace(/\s+/g,' ').slice(0,140);
    }
  } finally {await pdf.cleanup().catch(()=>{});}
}
export async function inspectForm(bytes:Uint8Array,withNearby=false):Promise<FormInfo> {
  const {doc,reason,xfa}=await open(bytes);
  if(!doc)return {supported:false,reason,xfa,pages:0,fields:[]};
  const fields=doc.getForm().getFields().map(f=>describe(doc,f));
  if(withNearby)await nearby(bytes,fields).catch(()=>{});
  if(!fields.length)return {supported:false,reason:'This PDF has no fillable fields. It may be a scan or a flat form; prepare an answer sheet the student can copy, or look for a fillable version.',xfa,pages:doc.getPageCount(),fields};
  if(fields.some(f=>f.type==='signature'&&f.value==='signed'))return {supported:false,reason:'This PDF is already signed; changing it would invalidate the signature. Ask for a blank copy.',xfa,pages:doc.getPageCount(),fields};
  return {supported:true,xfa,pages:doc.getPageCount(),fields};
}
export type FillReport={filled:string[];problems:string[];warnings:string[];blankRequired:string[];blank:string[]};
// All or nothing: any problem means no file is produced, so a half-filled form is never delivered by mistake.
export async function fillForm(bytes:Uint8Array,values:Record<string,Value>,flatten=false):Promise<{report:FillReport;pdf?:Uint8Array;flat?:Uint8Array}> {
  const report:FillReport={filled:[],problems:[],warnings:[],blankRequired:[],blank:[]};
  const info=await inspectForm(bytes);
  if(!info.supported){report.problems.push(info.reason!);return {report};}
  const {doc}=await open(bytes),form=doc!.getForm(),font=await doc!.embedFont(StandardFonts.Helvetica);
  if(info.xfa==='hybrid')report.warnings.push('The form also had an XFA layer; it was removed so every PDF viewer shows these values.');
  for(const [name,value] of Object.entries(values)) {
    const f=form.getFieldMaybe(name),label=info.fields.find(x=>x.name===name)?.label||name;
    if(!f){report.problems.push(`No field named "${name}"`);continue;}
    if(f.isReadOnly()){report.problems.push(`"${label}" is read-only`);continue;}
    try {
      if(f instanceof PDFTextField) {
        if(typeof value!=='string')throw Error('needs text');
        const max=f.getMaxLength();if(max!==undefined&&value.length>max)throw Error(`allows at most ${max} characters`);
        try{font.encodeText(value);}catch{throw Error('contains characters the form font cannot show; write them in Latin letters or leave it for the student');}
        f.setText(value);
        const rect=f.acroField.getWidgets()[0]?.getRectangle();
        if(rect&&!f.isMultiline()&&value&&font.widthOfTextAtSize(value,10)>rect.width-4)report.warnings.push(`"${label}" may be cut off or shrunk; check it in the preview`);
      } else if(f instanceof PDFCheckBox){if(typeof value!=='boolean')throw Error('needs true or false');value?f.check():f.uncheck();}
      else if(f instanceof PDFRadioGroup){if(typeof value!=='string'||!f.getOptions().includes(value))throw Error(`must be one of ${JSON.stringify(f.getOptions())}`);f.select(value);}
      else if(f instanceof PDFDropdown||f instanceof PDFOptionList) {
        const chosen=Array.isArray(value)?value:[value];const options=f.getOptions();
        if(!chosen.every(v=>typeof v==='string'&&(options.includes(v)||(f instanceof PDFDropdown&&f.isEditable()))))throw Error(`must be from ${JSON.stringify(options)}`);
        f.select(chosen as string[]);
      } else throw Error('cannot be filled here (signatures and buttons are for the student)');
      report.filled.push(name);
    } catch(error) {report.problems.push(`"${label}" (${name}) ${(error as Error).message}`);}
  }
  for(const field of form.getFields()) {
    const d=describe(doc!,field);if(d.type==='button'||d.type==='signature')continue;
    const empty=d.value===null||d.value===false||d.value===''||(Array.isArray(d.value)&&!d.value.length);
    if(empty)(d.required?report.blankRequired:report.blank).push(d.label);
  }
  if(report.problems.length)return {report};
  form.updateFieldAppearances(font);
  const pdf=await doc!.save();
  let flat:Uint8Array|undefined;
  if(flatten){const copy=await PDFDocument.load(pdf);copy.getForm().flatten();flat=await copy.save();}
  return {report,pdf,flat};
}
export async function verifyForm(bytes:Uint8Array,values:Record<string,Value>) {
  const info=await inspectForm(bytes),mismatches:string[]=[];
  for(const [name,value] of Object.entries(values)) {
    const f=info.fields.find(x=>x.name===name);
    // PDF text fields represent both unset and explicitly cleared text as null on inspection.
    const actual=f?.type==='text'?(f.value??''):f?.value,expected=value;
    if(!f||JSON.stringify(Array.isArray(actual)?actual:actual??null)!==JSON.stringify(Array.isArray(expected)?expected:(f?.type==='dropdown'||f?.type==='list')?[expected]:expected))mismatches.push(`${f?.label||name}: expected ${JSON.stringify(value)}, found ${JSON.stringify(actual)}`);
  }
  return {ok:!mismatches.length,mismatches};
}
