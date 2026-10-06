import { describe, expect, it } from 'vitest';

import { csvCell } from '../src/domains/ledger/queries/ledger-export.js';

/**
 * The export is opened in a spreadsheet by a finance person. A ledger description can carry text
 * a user typed (a refund reason), so a cell that starts with `=` is a formula the admin's own
 * machine would run: the cell is neutralised, then quoted if the format needs it.
 */
describe('csvCell', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['-5', "'-5"],
    ['+91', "'+91"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', `"'\rcmd"`],
    ['line\nbreak', '"line\nbreak"'],
    ['cr\rbreak', '"cr\rbreak"'],
    ['plain text', 'plain text'],
    ['refund: admin', 'refund: admin'],
    ['', ''],
  ])('%j becomes %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('prefixes the apostrophe before quoting, so a formula with a comma is both', () => {
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });

  it('writes numbers bare and null as an empty cell', () => {
    expect(csvCell(9702)).toBe('9702');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
  });

  it('does not treat a negative number as a formula: a number is not text', () => {
    expect(csvCell(-5)).toBe('-5');
  });
});
