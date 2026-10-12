/**
 * Streaming RFC 4180 CSV parser. Handles quoted fields containing commas,
 * doubled quotes and line breaks, across chunk boundaries. Yields one row at a time.
 */
export async function* parseCsv(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let pendingQuote = false; // saw a quote inside a quoted field; next char decides
  let pendingCR = false;
  let first = true;

  for await (let chunk of chunks) {
    if (first) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      first = false;
    }
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i]!;
      if (pendingCR) {
        pendingCR = false;
        if (c === "\n") continue;
      }
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          field += '"';
          continue;
        }
        inQuotes = false; // the quote closed the field; fall through to handle c
      }
      if (inQuotes) {
        if (c === '"') pendingQuote = true;
        else field += c;
        continue;
      }
      if (c === '"' && field === "") inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        row.push(field);
        field = "";
        yield row;
        row = [];
        pendingCR = c === "\r";
      } else field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}
