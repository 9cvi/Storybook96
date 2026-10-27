/* Storybook '96 web loader.
 *
 * GitHub's website only accepts uploads up to 25 MB, and the engine (index.wasm)
 * is about 40 MB. So for GitHub Pages it is stored gzipped (index.wasm.gz,
 * about 10 MB) and unpacked here while it downloads, which also makes it about
 * four times quicker to download on a phone.
 *
 * If a .gz file isn't there, the plain file is loaded as usual. Browsers
 * without DecompressionStream (iPhones before iOS 16.4) use the small
 * inflater below.
 */
(function () {
  'use strict';

  /* ---- tiny gzip inflater (fallback), after Joergen Ibsen's tinf / devongovett's tiny-inflate (MIT) ---- */
  function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
  var sltree = new Tree(), sdtree = new Tree();
  var lengthBits = new Uint8Array(30), lengthBase = new Uint16Array(30);
  var distBits = new Uint8Array(30), distBase = new Uint16Array(30);
  var clcidx = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var codeTree = new Tree(), lengths = new Uint8Array(288 + 32), offs = new Uint16Array(16);

  function bitsBase(bits, base, delta, first) {
    var i, sum;
    for (i = 0; i < delta; ++i) bits[i] = 0;
    for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
    for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; }
  }
  function fixedTrees(lt, dt) {
    var i;
    for (i = 0; i < 7; ++i) lt.table[i] = 0;
    lt.table[7] = 24; lt.table[8] = 152; lt.table[9] = 112;
    for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
    for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
    for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
    for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;
    for (i = 0; i < 5; ++i) dt.table[i] = 0;
    dt.table[5] = 32;
    for (i = 0; i < 32; ++i) dt.trans[i] = i;
  }
  function buildTree(t, lens, off, num) {
    var i, sum;
    for (i = 0; i < 16; ++i) t.table[i] = 0;
    for (i = 0; i < num; ++i) t.table[lens[off + i]]++;
    t.table[0] = 0;
    for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.table[i]; }
    for (i = 0; i < num; ++i) if (lens[off + i]) t.trans[offs[lens[off + i]]++] = i;
  }
  function getbit(d) {
    if (!d.bitcount--) { d.tag = d.source[d.si++]; d.bitcount = 7; }
    var bit = d.tag & 1;
    d.tag >>>= 1;
    return bit;
  }
  function readBits(d, num, base) {
    if (!num) return base;
    while (d.bitcount < 24) { d.tag |= d.source[d.si++] << d.bitcount; d.bitcount += 8; }
    var val = d.tag & (0xffff >>> (16 - num));
    d.tag >>>= num;
    d.bitcount -= num;
    return val + base;
  }
  function decodeSymbol(d, t) {
    while (d.bitcount < 24) { d.tag |= d.source[d.si++] << d.bitcount; d.bitcount += 8; }
    var sum = 0, cur = 0, len = 0, tag = d.tag;
    do {
      cur = 2 * cur + (tag & 1);
      tag >>>= 1;
      ++len;
      sum += t.table[len];
      cur -= t.table[len];
    } while (cur >= 0);
    d.tag = tag;
    d.bitcount -= len;
    return t.trans[sum + cur];
  }
  function decodeTrees(d, lt, dt) {
    var hlit = readBits(d, 5, 257), hdist = readBits(d, 5, 1), hclen = readBits(d, 4, 4);
    var i, num, length, sym, prev;
    for (i = 0; i < 19; ++i) lengths[i] = 0;
    for (i = 0; i < hclen; ++i) lengths[clcidx[i]] = readBits(d, 3, 0);
    buildTree(codeTree, lengths, 0, 19);
    for (num = 0; num < hlit + hdist;) {
      sym = decodeSymbol(d, codeTree);
      if (sym === 16) { prev = lengths[num - 1]; for (length = readBits(d, 2, 3); length; --length) lengths[num++] = prev; }
      else if (sym === 17) { for (length = readBits(d, 3, 3); length; --length) lengths[num++] = 0; }
      else if (sym === 18) { for (length = readBits(d, 7, 11); length; --length) lengths[num++] = 0; }
      else lengths[num++] = sym;
    }
    buildTree(lt, lengths, 0, hlit);
    buildTree(dt, lengths, hlit, hdist);
  }
  function blockData(d, lt, dt) {
    var out = d.dest;
    for (;;) {
      var sym = decodeSymbol(d, lt);
      if (sym === 256) return;
      if (sym < 256) { out[d.len++] = sym; continue; }
      sym -= 257;
      var length = readBits(d, lengthBits[sym], lengthBase[sym]);
      var dist = decodeSymbol(d, dt);
      var from = d.len - readBits(d, distBits[dist], distBase[dist]);
      for (var i = from; i < from + length; ++i) out[d.len++] = out[i];
    }
  }
  function storedBlock(d) {
    while (d.bitcount >= 8) { d.si--; d.bitcount -= 8; }  // give back whole bytes we read ahead
    var length = 256 * d.source[d.si + 1] + d.source[d.si];
    d.si += 4;
    for (var i = length; i; --i) d.dest[d.len++] = d.source[d.si++];
    d.bitcount = 0;
  }
  function inflate(source, dest) {
    var d = { source: source, si: 0, tag: 0, bitcount: 0, dest: dest, len: 0, lt: new Tree(), dt: new Tree() };
    var last, type;
    do {
      last = getbit(d);
      type = readBits(d, 2, 0);
      if (type === 0) storedBlock(d);
      else if (type === 1) blockData(d, sltree, sdtree);
      else if (type === 2) { decodeTrees(d, d.lt, d.dt); blockData(d, d.lt, d.dt); }
      else throw new Error('gzloader: bad deflate data');
    } while (!last);
    return d.len;
  }
  fixedTrees(sltree, sdtree);
  bitsBase(lengthBits, lengthBase, 4, 3);
  bitsBase(distBits, distBase, 2, 1);
  lengthBits[28] = 0;
  lengthBase[28] = 258;

  function gunzip(src) {
    var flags = src[3], pos = 10;
    if (flags & 4) pos += 2 + src[pos] + 256 * src[pos + 1];
    if (flags & 8) { while (src[pos++]); }
    if (flags & 16) { while (src[pos++]); }
    if (flags & 2) pos += 2;
    var n = src.length;
    var size = (src[n - 4] | (src[n - 3] << 8) | (src[n - 2] << 16) | (src[n - 1] << 24)) >>> 0;
    var out = new Uint8Array(size);
    inflate(src.subarray(pos, n - 8), out);
    return out;
  }

  /* ---- fetch hook ---- */
  function isGzip(b) { return !!b && b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b; }

  // Some servers already undo the gzip for us (Content-Encoding), so look before unpacking.
  function streamUnpack(body) {
    var reader = body.getReader();
    return reader.read().then(function (first) {
      var head = first.done ? new Uint8Array(0) : first.value;
      var stream = new ReadableStream({
        start: function (c) { if (first.done) c.close(); else c.enqueue(head); },
        pull: function (c) {
          return reader.read().then(function (r) { if (r.done) c.close(); else c.enqueue(r.value); });
        }
      });
      return isGzip(head) ? stream.pipeThrough(new DecompressionStream('gzip')) : stream;
    });
  }

  function unpack(response, type) {
    var headers = { 'Content-Type': type };
    if (window.DecompressionStream && window.ReadableStream && response.body) {
      return streamUnpack(response.body).then(function (s) { return new Response(s, { status: 200, headers: headers }); });
    }
    return response.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      return new Response(isGzip(bytes) ? gunzip(bytes) : bytes, { status: 200, headers: headers });
    });
  }

  var realFetch = window.fetch.bind(window);
  window.gzloaderGunzip = gunzip;  // exposed for tests
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /\.wasm(\?[^#]*)?$/.exec(url);  // only the engine is too big; index.pck stays plain
    if (!m) return realFetch(input, init);
    var gzUrl = url.slice(0, m.index) + '.wasm.gz' + (m[1] || '');
    return realFetch(gzUrl, init).then(function (r) {
      return r.ok ? unpack(r, 'application/wasm') : realFetch(input, init);
    }, function () { return realFetch(input, init); });
  };
})();
