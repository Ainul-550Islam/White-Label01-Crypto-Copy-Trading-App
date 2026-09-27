/**
 * CRC-32 (IEEE 802.3, the zlib/PNG polynomial 0xEDB88320, reflected).
 *
 * The partition math is only a partition scheme if BOTH languages agree on
 * every input, and agreement needs a hash with a specified answer:
 * `string.prototype.hashCode`-style folklore, `Buffer.hash`, or anything
 * salted/seeded is out. CRC-32 is what Python's `zlib.crc32` computes, it
 * fits in an unsigned 32-bit value so no BigInt anywhere, and a 256-entry
 * table is smaller than the bug of misimplementing it.
 *
 * Node's `zlib.crc32` exists only on very recent versions; rather than make
 * the coordination layer's correctness depend on the platform minimum, this
 * is the reference table implementation, pinned against the Python side by
 * docs/fixtures/coordination_fixtures.json.
 */

const POLYNOMIAL = 0xedb88320;

const TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** Unsigned CRC-32 of raw bytes (Python `zlib.crc32` parity). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Unsigned CRC-32 of the UTF-8 encoding of `text` - what the partition
 * functions use, so both languages hash the exact same byte sequence for a
 * given string (Node and Python UTF-8 are byte-identical by construction;
 * neither side normalises). */
export function crc32Utf8(text: string): number {
  return crc32(new TextEncoder().encode(text));
}
