const UNSAFE_DROP_TABLE = /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i;
const DOLLAR_QUOTE_START = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

function masked(character: string): string {
  return character === '\n' || character === '\r' ? character : ' ';
}

export function stripSqlComments(sql: string): string {
  let output = '';
  let index = 0;
  let blockDepth = 0;
  let dollarTag: string | null = null;
  let quote: "'" | '"' | null = null;
  let escapeString = false;

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
        output += masked(current);
        index += 1;
      }
      continue;
    }

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        output += ' '.repeat(dollarTag.length);
        index += dollarTag.length;
        dollarTag = null;
      } else {
        output += masked(current);
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (escapeString && current === '\\') {
        output += ' ';
        index += 1;
        if (index < sql.length) {
          output += masked(sql[index]);
          index += 1;
        }
        continue;
      }
      output += masked(current);
      index += 1;
      if (current === quote) {
        if (sql[index] === quote) {
          output += ' ';
          index += 1;
        } else {
          quote = null;
          escapeString = false;
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
      const prefix = sql[index - 1];
      const beforePrefix = sql[index - 2];
      escapeString =
        current === "'" &&
        (prefix === 'E' || prefix === 'e') &&
        (index < 2 || !/[A-Za-z0-9_$]/.test(beforePrefix));
      quote = current;
      output += ' ';
      index += 1;
      continue;
    }

    if (
      current === '
      if (match) {
        dollarTag = match[0];
        output += ' '.repeat(dollarTag.length);
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
 &&
      (index === 0 || !/[A-Za-z0-9_$\u0080-\uFFFF]/.test(sql[index - 1]))
    ) {
      const match = sql.slice(index).match(DOLLAR_QUOTE_START);
      if (match) {
        dollarTag = match[0];
        output += ' '.repeat(dollarTag.length);
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
