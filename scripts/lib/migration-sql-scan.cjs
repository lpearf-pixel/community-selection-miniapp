function blank(segment) {
  return segment.replace(/[^\r\n]/g, ' ');
}

function dollarDelimiterAt(sql, index) {
  const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0];
}

function stripNonExecutableSql(sql) {
  let output = '';
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index);
      const stop = end < 0 ? sql.length : end;
      output += blank(sql.slice(index, stop));
      index = stop;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < sql.length && depth > 0) {
        if (sql.startsWith('/*', cursor)) {
          depth += 1;
          cursor += 2;
        } else if (sql.startsWith('*/', cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      output += blank(sql.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (sql[index] === "'") {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] !== "'") {
          cursor += 1;
          continue;
        }
        if (sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        cursor += 1;
        break;
      }
      output += blank(sql.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (sql[index] === '$') {
      const delimiter = dollarDelimiterAt(sql, index);
      if (delimiter) {
        const end = sql.indexOf(delimiter, index + delimiter.length);
        const cursor = end < 0 ? sql.length : end + delimiter.length;
        output += blank(sql.slice(index, cursor));
        index = cursor;
        continue;
      }
    }

    output += sql[index];
    index += 1;
  }

  return output;
}

function hasUnsafeDropTable(sql) {
  return /\bDROP\s+TABLE\s+(?!IF\s+EXISTS\b)/i.test(
    stripNonExecutableSql(sql),
  );
}

module.exports = {
  hasUnsafeDropTable,
  stripNonExecutableSql,
};
