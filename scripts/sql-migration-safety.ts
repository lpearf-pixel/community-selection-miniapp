const UNSAFE_DROP_TABLE = /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i;
const DOLLAR_QUOTE_START = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

export function stripSqlComments(sql: string): string {
  let output = '';
  let index = 0;
  let blockDepth = 0;
  let dollarTag: string | null = null;
  let quote: "'" | '"' | null = null;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (blockDepth > 0) {
      if (current === '/' && next === '*') {
        blockDepth += 1;
        output += '  ';
        index += 2;
      } else if (current === '*' && next === '/') {
        blockDepth -= 1;
        output += '  ';
        index += 2;
      } else {
        output += current === '\n' || current === '\r' ? current : ' ';
        index += 1;
      }
      continue;
    }

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        output += current;
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      output += current;
      index += 1;
      if (current === quote) {
        if (sql[index] === quote) {
          output += sql[index];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (current === '-' && next === '-') {
      output += '  ';
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      blockDepth = 1;
      output += '  ';
      index += 2;
      continue;
    }

    if (current === "'" || current === '"') {
      quote = current;
      output += current;
      index += 1;
      continue;
    }

    if (current === '$') {
      const match = sql.slice(index).match(DOLLAR_QUOTE_START);
      if (match) {
        dollarTag = match[0];
        output += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }

    output += current;
    index += 1;
  }

  return output;
}

export function containsUnsafeDropTable(sql: string): boolean {
  return UNSAFE_DROP_TABLE.test(stripSqlComments(sql));
}
