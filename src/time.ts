// Local wall-clock times in a student's IANA time zone, using only Intl (no Temporal assumption).
export function validZone(zone:string) {
  if(!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)&&zone!=='UTC')return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone:zone});return true;} catch {return false;}
}
// Milliseconds the zone is ahead of UTC at the given instant.
function offset(instant:number,zone:string) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})
    .formatToParts(new Date(instant)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)-Math.floor(instant/1000)*1000;
}
// "2026-10-25T17:00" in America/New_York → UTC epoch ms. A time skipped by a daylight-saving jump moves forward by
// the length of the jump; a repeated time uses its first occurrence.
export function zonedToUtc(local:string,zone:string) {
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if(!m||!validZone(zone))return undefined;
  const [y,mo,d,h,mi]=m.slice(1).map(Number);
  const wall=Date.UTC(y,mo-1,d,h,mi);
  const check=new Date(wall);if(check.getUTCMonth()!==mo-1||check.getUTCDate()!==d||h>23||mi>59)return undefined;
  // Try both offsets around the moment; keep the earliest instant that shows this wall time.
  const candidates=[offset(wall-36e5*14,zone),offset(wall,zone),offset(wall+36e5*14,zone)].map(o=>wall-o).filter(t=>t-wall+offset(t,zone)===0).sort((a,b)=>a-b);
  if(candidates.length)return candidates[0];
  // Skipped time: read it with the offset from before the jump, which lands just after it (2:30 becomes 3:30).
  return wall-offset(wall-36e5*14,zone);
}
export function formatLocal(instant:number,zone:string,locale='en-US') {
  return new Intl.DateTimeFormat(locale,{timeZone:zone,weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(instant));
}
