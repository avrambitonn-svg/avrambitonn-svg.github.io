// Does a file start the way its declared type says? Used for uploads from the public portal, where the
// content type comes from a stranger: an HTML page labelled image/png must not be stored as an image.
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/heic': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'image/heif': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

/** true when `head` (the first bytes) matches `mime`; types without a known signature are not accepted. */
export function looksLike(mime, head) {
  const test = SIGNATURES[mime];
  return Boolean(test && head && head.length >= 12 && test(head));
}
