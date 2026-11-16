import { expect, test } from 'bun:test';
import { extractContacts, parseCsv } from '../src/lib/csv';

test('parses quoted fields and CRLF', () => {
  expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n')).toEqual([['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
});

test('extracts contacts with or without header', () => {
  expect(extractContacts(parseCsv('Name,Email,Lang\nAna,ANA@x.com,pt-BR\nBo,bo@y.com,en'))).toEqual([
    { email: 'ana@x.com', lang: 'pt' },
    { email: 'bo@y.com', lang: 'en' },
  ]);
  expect(extractContacts(parseCsv('a@x.com\nb@y.com'))).toEqual([
    { email: 'a@x.com', lang: 'en' },
    { email: 'b@y.com', lang: 'en' },
  ]);
  expect(extractContacts(parseCsv('name;email\nX;x@z.io'))).toEqual([{ email: 'x@z.io', lang: 'en' }]);
});
