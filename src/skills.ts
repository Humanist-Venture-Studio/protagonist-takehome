import { readdirSync, readFileSync } from 'node:fs';

export type Skill = { name: string; description: string; path: string };
// Skills are folders baked into the worker image: SKILL.md (front matter with name and description) plus assets and scripts.
export function listSkills(dir:string):Skill[] {
  let names:string[]=[];try{names=readdirSync(dir).sort();}catch{return [];}
  return names.flatMap(name=>{
    try {
      const text=readFileSync(`${dir}/${name}/SKILL.md`,'utf8'),front=text.match(/^---\n([\s\S]*?)\n---/)?.[1]||'';
      const description=front.match(/^description:\s*(.+)$/m)?.[1]?.trim();
      return description?[{name,description,path:`${dir.replace(/\/$/,'')}/${name}/SKILL.md`}]:[];
    } catch {return [];}
  });
}
