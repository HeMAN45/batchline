export function parseDelimited(input, delimiter = detectDelimiter(input)) {
  const text = input.replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
  };
  const endRow = () => {
    endCell();
    if (row.some(value => value !== '') || row.length > 1) records.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === delimiter) endCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      endRow();
    } else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Malformed CSV near record ' + (records.length + 1) + '.');
      cell += char;
    }
  }
  if (quoted) throw new Error('A quoted field was left open.');
  if (cell || row.length || closed) endRow();
  const headers = records.shift()?.map(value => value.trim());
  if (!headers?.length || !records.length) throw new Error('Include a header and at least one data row.');
  if (headers.includes('') || new Set(headers.map(value => value.toLowerCase())).size !== headers.length) {
    throw new Error('Column headings must be nonempty and unique.');
  }
  return { headers, records, delimiter };
}

function detectDelimiter(text) {
  const candidates = [',', '\t', ';'];
  const counts = new Map(candidates.map(candidate => [candidate, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === '\n' || char === '\r') break;
    if (counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  return candidates.sort((left, right) => counts.get(right) - counts.get(left))[0];
}

export function writeCsv(rows, { spreadsheetSafe = false } = {}) {
  return rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (spreadsheetSafe && /^[\s\u0000-\u001f]*[=+@-]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(',')).join('\r\n');
}
