/** What a file under a message says at a glance: its own title and the first
 * thing it says, as plain words. The card used to print the raw first five
 * lines, `#` marks and all, in a 180px box. */
export function fileGlance(text:string):{title:string|null;line:string|null} {
  let title:string|null=null, line:string|null=null, inFence=false;
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {inFence=!inFence;continue;}
    if (inFence) continue;
    const heading=raw.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (heading) {if (!title && heading[1]) title=plain(heading[1]);continue;}
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(raw) || /^\s*\|/.test(raw) || /^\s*<!--/.test(raw)) continue;
    const words=plain(raw.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/,''));
    if (words) {line=words;break;}
  }
  return {title,line};
}

function plain(s:string) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g,'$2')
    .replace(/\s+/g,' ')
    .trim();
}
