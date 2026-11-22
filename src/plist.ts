/**
 * Just enough of Apple's XML property list format to read `ioreg -a`:
 * dict, array, string, integer, real, true, false, date and data
 * (https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/PropertyLists/AboutPropertyLists/AboutPropertyLists.html,
 * DTD http://www.apple.com/DTDs/PropertyList-1.0.dtd). Not a validator:
 * anything it doesn't know is skipped.
 */
export type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue } | null;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? whole),
  );

export function parsePlist(xml: string): PlistValue {
  const tokens = xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) ?? [];
  let i = 0;
  const skipText = () => {
    while (i < tokens.length && !tokens[i]!.startsWith('<')) i++;
  };
  const textUntil = (close: string): string => {
    let s = '';
    while (i < tokens.length && tokens[i] !== close) s += tokens[i++];
    i++;
    return unescape(s);
  };
  const value = (): PlistValue => {
    skipText();
    const tag = tokens[i++];
    if (tag === undefined) return null;
    const name = /^<\/?\s*([\w]+)/.exec(tag)?.[1] ?? '';
    const selfClosing = tag.endsWith('/>');
    switch (name) {
      case 'plist':
        return value();
      case 'dict': {
        const o: Record<string, PlistValue> = {};
        if (selfClosing) return o;
        for (;;) {
          skipText();
          const t = tokens[i];
          if (t === undefined || t.startsWith('</dict')) {
            i++;
            return o;
          }
          if (t.startsWith('<key')) {
            i++;
            const k = textUntil('</key>');
            o[k] = value();
          } else i++;
        }
      }
      case 'array': {
        const a: PlistValue[] = [];
        if (selfClosing) return a;
        for (;;) {
          skipText();
          const t = tokens[i];
          if (t === undefined || t.startsWith('</array')) {
            i++;
            return a;
          }
          a.push(value());
        }
      }
      case 'string':
      case 'date':
      case 'data':
        return selfClosing ? '' : textUntil(`</${name}>`).trim();
      case 'integer':
      case 'real':
        return Number(textUntil(`</${name}>`).trim());
      case 'true':
        return true;
      case 'false':
        return false;
      default:
        return null;
    }
  };
  return value();
}
