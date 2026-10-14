/*
 * C implementation of Ethereum Modified Merkle Patricia Trie.
 * Bit-exact with the Haskell merkle-patricia-db implementation.
 */

#include "mp_trie.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>
#include <leveldb/c.h>

/* ================================================================
 * SECTION 1: Keccak-256 (static, from keccak-tiny)
 * ================================================================ */

static const uint8_t kk_rho[24] =
  { 1,  3,  6, 10, 15, 21, 28, 36, 45, 55,  2, 14,
   27, 41, 56,  8, 25, 43, 62, 18, 39, 61, 20, 44};
static const uint8_t kk_pi[24] =
  {10,  7, 11, 17, 18,  3,  5, 16,  8, 21, 24,  4,
   15, 23, 19, 13, 12,  2, 20, 14, 22,  9,  6,  1};
static const uint64_t kk_RC[24] =
  {1ULL, 0x8082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
   0x808bULL, 0x80000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
   0x8aULL, 0x88ULL, 0x80008009ULL, 0x8000000aULL,
   0x8000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
   0x8000000000008002ULL, 0x8000000000000080ULL, 0x800aULL, 0x800000008000000aULL,
   0x8000000080008081ULL, 0x8000000000008080ULL, 0x80000001ULL, 0x8000000080008008ULL};

#define kk_rol(x, s) (((x) << (s)) | ((x) >> (64 - (s))))

static void kk_keccakf(uint64_t *a) {
    uint64_t b[5] = {0};
    uint64_t t = 0;
    uint8_t x, y;
    for (int i = 0; i < 24; i++) {
        for (x = 0; x < 5; x++) {
            b[x] = 0;
            for (y = 0; y < 25; y += 5) b[x] ^= a[x + y];
        }
        for (x = 0; x < 5; x++)
            for (y = 0; y < 25; y += 5)
                a[y + x] ^= b[(x + 4) % 5] ^ kk_rol(b[(x + 1) % 5], 1);
        t = a[1];
        x = 0;
        for (int j = 0; j < 24; j++) {
            b[0] = a[kk_pi[x]];
            a[kk_pi[x]] = kk_rol(t, kk_rho[x]);
            t = b[0];
            x++;
        }
        for (y = 0; y < 25; y += 5) {
            for (x = 0; x < 5; x++) b[x] = a[y + x];
            for (x = 0; x < 5; x++)
                a[y + x] = b[x] ^ ((~b[(x + 1) % 5]) & b[(x + 2) % 5]);
        }
        a[0] ^= kk_RC[i];
    }
}

static void mp_keccak256(uint8_t out[32], const uint8_t *in, size_t inlen) {
    uint8_t a[200];
    memset(a, 0, 200);
    size_t rate = 136; /* 200 - 2*32 */
    while (inlen >= rate) {
        for (size_t i = 0; i < rate; i++) a[i] ^= in[i];
        kk_keccakf((uint64_t*)a);
        in += rate;
        inlen -= rate;
    }
    for (size_t i = 0; i < inlen; i++) a[i] ^= in[i];
    a[inlen] ^= 0x01;   /* keccak padding (not SHA-3) */
    a[rate - 1] ^= 0x80;
    kk_keccakf((uint64_t*)a);
    memcpy(out, a, 32);
}

/* ================================================================
 * SECTION 2: RLP encoding helpers
 * ================================================================ */

static int uint_byte_len(size_t val) {
    if (val < 0x100) return 1;
    if (val < 0x10000) return 2;
    if (val < 0x1000000) return 3;
    if (val < 0x100000000ULL) return 4;
    return 5;
}

static void encode_uint_be(size_t val, uint8_t *out, int len) {
    for (int i = len - 1; i >= 0; i--) {
        out[i] = (uint8_t)(val & 0xFF);
        val >>= 8;
    }
}

static size_t decode_uint_be(const uint8_t *data, int len) {
    size_t r = 0;
    for (int i = 0; i < len; i++) r = (r << 8) | data[i];
    return r;
}

/* static size_t rlp_bytes_encoded_size(size_t data_len) — unused */

/* Encode a byte string as RLP. Returns bytes written. */
static size_t rlp_encode_bytes(const uint8_t *data, size_t len, uint8_t *out) {
    if (len == 0) {
        out[0] = 0x80;
        return 1;
    }
    if (len == 1 && data[0] < 128) {
        out[0] = data[0];
        return 1;
    }
    if (len <= 55) {
        out[0] = (uint8_t)(0x80 + len);
        memcpy(out + 1, data, len);
        return 1 + len;
    }
    int ll = uint_byte_len(len);
    out[0] = (uint8_t)(0xB7 + ll);
    encode_uint_be(len, out + 1, ll);
    memcpy(out + 1 + ll, data, len);
    return 1 + (size_t)ll + len;
}

/* Encode an RLP list from pre-serialized content. Returns bytes written. */
static size_t rlp_encode_list(const uint8_t *content, size_t clen, uint8_t *out) {
    if (clen <= 55) {
        out[0] = (uint8_t)(0xC0 + clen);
        memcpy(out + 1, content, clen);
        return 1 + clen;
    }
    int ll = uint_byte_len(clen);
    out[0] = (uint8_t)(0xF7 + ll);
    encode_uint_be(clen, out + 1, ll);
    memcpy(out + 1 + ll, content, clen);
    return 1 + (size_t)ll + clen;
}

static size_t rlp_list_overhead(size_t clen) {
    if (clen <= 55) return 1;
    return 1 + (size_t)uint_byte_len(clen);
}

/* ================================================================
 * SECTION 3: RLP decoding helpers
 * ================================================================ */

typedef struct {
    const uint8_t *start;   /* pointer to first byte of item */
    size_t total;           /* total bytes consumed */
    int is_list;
    const uint8_t *content; /* content bytes (after prefix) */
    size_t clen;            /* content length */
} rlp_item_t;

static int rlp_decode_item(const uint8_t *data, size_t dlen, rlp_item_t *o) {
    if (dlen == 0) return -1;
    uint8_t b = data[0];
    o->start = data;
    if (b < 0x80) {
        o->total = 1; o->is_list = 0; o->content = data; o->clen = 1;
    } else if (b <= 0xB7) {
        size_t l = b - 0x80;
        if (1 + l > dlen) return -1;
        o->total = 1 + l; o->is_list = 0; o->content = data + 1; o->clen = l;
    } else if (b <= 0xBF) {
        int ll = b - 0xB7;
        if (1 + (size_t)ll > dlen) return -1;
        size_t l = decode_uint_be(data + 1, ll);
        if (1 + (size_t)ll + l > dlen) return -1;
        o->total = 1 + (size_t)ll + l; o->is_list = 0; o->content = data + 1 + ll; o->clen = l;
    } else if (b <= 0xF7) {
        size_t l = b - 0xC0;
        if (1 + l > dlen) return -1;
        o->total = 1 + l; o->is_list = 1; o->content = data + 1; o->clen = l;
    } else {
        int ll = b - 0xF7;
        if (1 + (size_t)ll > dlen) return -1;
        size_t l = decode_uint_be(data + 1, ll);
        if (1 + (size_t)ll + l > dlen) return -1;
        o->total = 1 + (size_t)ll + l; o->is_list = 1; o->content = data + 1 + ll; o->clen = l;
    }
    return 0;
}

/* ================================================================
 * SECTION 4: Hex-prefix encoding
 * ================================================================ */

/* Encode nibbles (one per byte) with hex-prefix.
 * Returns number of bytes written. */
static size_t hp_encode(const uint8_t *nibs, size_t nlen,
                        int is_leaf, uint8_t *out) {
    int extra = (is_leaf ? 2 : 0) + (nlen % 2 == 1 ? 1 : 0);
    if (nlen % 2 == 0) {
        out[0] = (uint8_t)(extra << 4);
        for (size_t i = 0; i < nlen; i += 2)
            out[1 + i/2] = (uint8_t)((nibs[i] << 4) | nibs[i+1]);
        return 1 + nlen / 2;
    } else {
        out[0] = (uint8_t)((extra << 4) | nibs[0]);
        for (size_t i = 1; i < nlen; i += 2)
            out[1 + (i-1)/2] = (uint8_t)((nibs[i] << 4) | nibs[i+1]);
        return 1 + (nlen - 1) / 2;
    }
}

/* static size_t hp_byte_len(size_t nlen) — unused */

/* Decode hex-prefix into nibbles. */
static void hp_decode(const uint8_t *in, size_t in_len,
                      uint8_t *nibs_out, size_t *nlen_out,
                      int *is_leaf_out) {
    uint8_t w = in[0];
    uint8_t flags;
    if (w > 0x0F) {
        flags = w >> 4;
    } else {
        flags = w;
    }
    *is_leaf_out = (flags >> 1) == 1;
    int odd = flags & 1;
    size_t n = 0;
    if (odd) nibs_out[n++] = w & 0x0F;
    for (size_t i = 1; i < in_len; i++) {
        nibs_out[n++] = in[i] >> 4;
        nibs_out[n++] = in[i] & 0x0F;
    }
    *nlen_out = n;
}

/* ================================================================
 * SECTION 5: Node store — a write-behind cache in front of LevelDB
 *
 * Open-addressed hash table keyed by node hash.  An entry is
 *   CLEAN    already in LevelDB (or loaded from it): evictable
 *   PENDING  created here, not yet written: kept until flushed
 *   SCRATCH  created inside a sandbox: never written, evictable
 * When the clean+scratch population reaches capacity the table is
 * rebuilt keeping only PENDING entries (same policy as the Haskell
 * BoundedMap it replaces).  Eviction and growth only happen between
 * trie operations; decoded nodes never point into the table.
 * ================================================================ */

#define STORE_INIT_CAP 131072

#define SLOT_FREE      0
#define SLOT_TOMB      1
#define ENTRY_CLEAN    2
#define ENTRY_PENDING  3
#define ENTRY_SCRATCH  4

typedef struct {
    uint8_t key[32];
    uint8_t *value;
    uint32_t value_len;
    uint8_t state;
} store_entry_t;

struct mp_store {
    store_entry_t *entries;
    uint32_t capacity;      /* slots, power of two */
    uint32_t count;         /* live entries */
    uint32_t tombs;
    uint32_t evictable;     /* CLEAN + SCRATCH entries */
    uint32_t max_evictable;
    /* keys of PENDING entries, in creation order */
    uint8_t (*pending)[32];
    uint32_t pending_count;
    uint32_t pending_cap;
    uint32_t flush_every;
    uint32_t ticks;
    int overlay_depth;
    int missing;
    uint8_t missing_hash[32];
    leveldb_t *ldb;
    leveldb_readoptions_t *ro;
    leveldb_writeoptions_t *wo;
    pthread_mutex_t lock;
};

static uint32_t store_slot(const mp_store_t *s, const uint8_t key[32]) {
    uint32_t h = (uint32_t)key[0] | ((uint32_t)key[1] << 8) |
                 ((uint32_t)key[2] << 16) | ((uint32_t)key[3] << 24);
    return h & (s->capacity - 1);
}

static store_entry_t *store_find(const mp_store_t *s, const uint8_t key[32]) {
    uint32_t slot = store_slot(s, key);
    while (s->entries[slot].state != SLOT_FREE) {
        if (s->entries[slot].state != SLOT_TOMB &&
            memcmp(s->entries[slot].key, key, 32) == 0)
            return &s->entries[slot];
        slot = (slot + 1) & (s->capacity - 1);
    }
    return NULL;
}

/* Rebuild into a table of new_cap slots; drop entries for which keep() is 0. */
static void store_rebuild(mp_store_t *s, uint32_t new_cap, int keep_evictable) {
    uint32_t old_cap = s->capacity;
    store_entry_t *old = s->entries;
    s->capacity = new_cap;
    s->entries = calloc(s->capacity, sizeof(store_entry_t));
    s->count = 0;
    s->tombs = 0;
    s->evictable = 0;
    for (uint32_t i = 0; i < old_cap; i++) {
        store_entry_t *e = &old[i];
        if (e->state == SLOT_FREE || e->state == SLOT_TOMB) continue;
        if (!keep_evictable && e->state != ENTRY_PENDING) { free(e->value); continue; }
        uint32_t slot = store_slot(s, e->key);
        while (s->entries[slot].state != SLOT_FREE) slot = (slot + 1) & (s->capacity - 1);
        s->entries[slot] = *e;
        s->count++;
        if (e->state != ENTRY_PENDING) s->evictable++;
    }
    free(old);
}

static void add_pending(mp_store_t *s, const uint8_t key[32]) {
    if (s->pending_count >= s->pending_cap) {
        s->pending_cap = s->pending_cap ? s->pending_cap * 2 : 1024;
        s->pending = realloc(s->pending, s->pending_cap * sizeof(*s->pending));
    }
    memcpy(s->pending[s->pending_count++], key, 32);
}

static void store_insert(mp_store_t *s, const uint8_t key[32],
                         const uint8_t *val, size_t vlen, uint8_t state) {
    if ((s->count + s->tombs) * 4 >= s->capacity * 3) store_rebuild(s, s->capacity * 2, 1);
    uint32_t slot = store_slot(s, key);
    while (s->entries[slot].state != SLOT_FREE) slot = (slot + 1) & (s->capacity - 1);
    store_entry_t *e = &s->entries[slot];
    memcpy(e->key, key, 32);
    e->value = malloc(vlen);
    memcpy(e->value, val, vlen);
    e->value_len = (uint32_t)vlen;
    e->state = state;
    s->count++;
    if (state == ENTRY_PENDING) add_pending(s, key);
    else s->evictable++;
}

/* A node produced by a trie operation (or handed in by the caller). */
static void store_put(mp_store_t *s, const uint8_t key[32],
                      const uint8_t *val, size_t vlen) {
    store_entry_t *e = store_find(s, key);
    if (e) {
        /* A sandbox node reborn outside the sandbox must now be written. */
        if (e->state == ENTRY_SCRATCH && s->overlay_depth == 0) {
            e->state = ENTRY_PENDING;
            s->evictable--;
            add_pending(s, key);
        }
        return;
    }
    store_insert(s, key, val, vlen, s->overlay_depth > 0 ? ENTRY_SCRATCH : ENTRY_PENDING);
}

static const uint8_t EMPTY_NODE_RLP[1] = { 0x80 };
static uint8_t EMPTY_ROOT[32];
static int EMPTY_ROOT_COMPUTED = 0;

void mp_empty_root(uint8_t root_out[32]) {
    if (!EMPTY_ROOT_COMPUTED) {
        mp_keccak256(EMPTY_ROOT, EMPTY_NODE_RLP, 1);
        EMPTY_ROOT_COMPUTED = 1;
    }
    memcpy(root_out, EMPTY_ROOT, 32);
}

/* Node bytes by hash: cache, then LevelDB (caching the hit).  The empty
 * trie's root is answered without a store.  NULL means missing; the hash is
 * recorded so the caller can report it. */
static const uint8_t *store_get(mp_store_t *s, const uint8_t key[32],
                                size_t *vlen_out) {
    store_entry_t *e = store_find(s, key);
    if (e) {
        *vlen_out = e->value_len;
        return e->value;
    }
    if (s->ldb) {
        char *err = NULL;
        size_t vlen = 0;
        char *v = leveldb_get(s->ldb, s->ro, (const char *)key, 32, &vlen, &err);
        if (err) leveldb_free(err);
        if (v) {
            store_insert(s, key, (const uint8_t *)v, vlen, ENTRY_CLEAN);
            leveldb_free(v);
            return store_get(s, key, vlen_out);
        }
    }
    uint8_t empty[32];
    mp_empty_root(empty);
    if (memcmp(key, empty, 32) == 0) {
        *vlen_out = 1;
        return EMPTY_NODE_RLP;
    }
    if (!s->missing) {
        s->missing = 1;
        memcpy(s->missing_hash, key, 32);
    }
    return NULL;
}

static int store_flush(mp_store_t *s) {
    if (!s->ldb) return 0;            /* in-memory: nothing is ever evicted */
    if (s->pending_count == 0) return 0;
    leveldb_writebatch_t *wb = leveldb_writebatch_create();
    for (uint32_t i = 0; i < s->pending_count; i++) {
        store_entry_t *e = store_find(s, s->pending[i]);
        if (!e || e->state != ENTRY_PENDING) continue;
        leveldb_writebatch_put(wb, (const char *)e->key, 32,
                               (const char *)e->value, e->value_len);
        e->state = ENTRY_CLEAN;
        s->evictable++;
    }
    char *err = NULL;
    leveldb_write(s->ldb, s->wo, wb, &err);
    leveldb_writebatch_destroy(wb);
    s->pending_count = 0;
    if (err) { leveldb_free(err); return -1; }
    return 0;
}

/* Between operations: make room if the clean population hit capacity. */
static void store_maybe_evict(mp_store_t *s) {
    if (s->evictable >= s->max_evictable) store_rebuild(s, s->capacity, 0);
}

/* ================================================================
 * SECTION 6: Node types and helpers
 * ================================================================ */

#define REF_EMPTY  0
#define REF_INLINE 1
#define REF_HASH   2

typedef struct {
    uint8_t type;
    uint8_t data[33];   /* inline: RLP bytes; hash: 32-byte hash */
    uint8_t data_len;   /* 0 for empty */
} node_ref_t;

#define NODE_EMPTY     0
#define NODE_BRANCH    1
#define NODE_EXTENSION 2
#define NODE_LEAF      3

typedef struct {
    uint8_t type;
    union {
        struct {
            node_ref_t children[16];
            uint8_t *value;
            uint32_t value_len;
        } branch;
        struct {
            uint8_t *nibbles;
            uint16_t nlen;
            node_ref_t child;
        } ext;
        struct {
            uint8_t *nibbles;
            uint16_t nlen;
            uint8_t *value;
            uint32_t value_len;
        } leaf;
    };
} mp_node_t;

static node_ref_t empty_ref(void) {
    node_ref_t r;
    r.type = REF_EMPTY;
    r.data_len = 0;
    return r;
}

static int is_empty_ref(const node_ref_t *r) {
    if (r->type == REF_EMPTY) return 1;
    if (r->type == REF_INLINE && r->data_len == 1 && r->data[0] == 0x80) return 1;
    return 0;
}

static uint8_t *dup_bytes(const uint8_t *src, size_t len) {
    if (!src || len == 0) return NULL;
    uint8_t *d = malloc(len);
    memcpy(d, src, len);
    return d;
}

static uint8_t *dup_nibs(const uint8_t *src, size_t n) {
    if (n == 0) return NULL;
    uint8_t *d = malloc(n);
    memcpy(d, src, n);
    return d;
}

static void free_node(mp_node_t *nd) {
    switch (nd->type) {
        case NODE_BRANCH:
            free(nd->branch.value);
            nd->branch.value = NULL;
            break;
        case NODE_EXTENSION:
            free(nd->ext.nibbles);
            nd->ext.nibbles = NULL;
            break;
        case NODE_LEAF:
            free(nd->leaf.nibbles);
            nd->leaf.nibbles = NULL;
            free(nd->leaf.value);
            nd->leaf.value = NULL;
            break;
        default:
            break;
    }
    nd->type = NODE_EMPTY;
}

/* How many bytes does serializing this ref take inside an RLP array? */
static size_t ref_serial_size(const node_ref_t *r) {
    switch (r->type) {
        case REF_EMPTY:  return 1;       /* \x80 */
        case REF_INLINE: return r->data_len;
        case REF_HASH:   return 33;      /* \xa0 + 32 bytes */
    }
    return 1;
}

/* Write the serialized form of a ref into buf. Returns bytes written. */
static size_t ref_serialize(const node_ref_t *r, uint8_t *out) {
    switch (r->type) {
        case REF_EMPTY:
            out[0] = 0x80;
            return 1;
        case REF_INLINE:
            memcpy(out, r->data, r->data_len);
            return r->data_len;
        case REF_HASH:
            out[0] = 0xA0;
            memcpy(out + 1, r->data, 32);
            return 33;
    }
    out[0] = 0x80;
    return 1;
}

/* Nibble equality check */
static int nibs_equal(const uint8_t *a, size_t alen,
                      const uint8_t *b, size_t blen) {
    if (alen != blen) return 0;
    return alen == 0 || memcmp(a, b, alen) == 0;
}

/* Check if a is a prefix of b */
static int nibs_is_prefix(const uint8_t *a, size_t alen,
                          const uint8_t *b, size_t blen) {
    if (alen > blen) return 0;
    return alen == 0 || memcmp(a, b, alen) == 0;
}

/* Find common prefix length between two nibble arrays */
static size_t nibs_common_len(const uint8_t *a, size_t alen,
                              const uint8_t *b, size_t blen) {
    size_t m = alen < blen ? alen : blen;
    for (size_t i = 0; i < m; i++) {
        if (a[i] != b[i]) return i;
    }
    return m;
}

/* Convert 32-byte key to 64 nibbles (one per byte) */
static void bytes_to_nibbles(const uint8_t key[32], uint8_t nibs[64]) {
    for (int i = 0; i < 32; i++) {
        nibs[i * 2]     = key[i] >> 4;
        nibs[i * 2 + 1] = key[i] & 0x0F;
    }
}

/* ================================================================
 * SECTION 7: Node encoding (mp_node_t → RLP bytes)
 * ================================================================ */

/* Encode a node to RLP. Caller must free the returned buffer.
 * Returns the RLP bytes and sets *out_len. */
static uint8_t *encode_node(const mp_node_t *nd, size_t *out_len) {
    if (nd->type == NODE_EMPTY) {
        uint8_t *r = malloc(1);
        r[0] = 0x80;
        *out_len = 1;
        return r;
    }

    if (nd->type == NODE_BRANCH) {
        /* Compute content size */
        size_t content_sz = 0;
        for (int i = 0; i < 16; i++)
            content_sz += ref_serial_size(&nd->branch.children[i]);
        if (nd->branch.value)
            content_sz += nd->branch.value_len;
        else
            content_sz += 1; /* \x80 for no-value */

        size_t overhead = rlp_list_overhead(content_sz);
        size_t total = overhead + content_sz;
        uint8_t *buf = malloc(total);

        /* Write content to temp buffer */
        uint8_t *content = malloc(content_sz);
        size_t pos = 0;
        for (int i = 0; i < 16; i++)
            pos += ref_serialize(&nd->branch.children[i], content + pos);
        if (nd->branch.value) {
            memcpy(content + pos, nd->branch.value, nd->branch.value_len);
            pos += nd->branch.value_len;
        } else {
            content[pos++] = 0x80;
        }

        *out_len = rlp_encode_list(content, pos, buf);
        free(content);
        return buf;
    }

    if (nd->type == NODE_EXTENSION) {
        /* HP-encode the key prefix */
        uint8_t hp[34];
        size_t hp_len = hp_encode(nd->ext.nibbles, nd->ext.nlen, 0, hp);

        /* RLP of HP key */
        uint8_t hp_rlp[36];
        size_t hp_rlp_len = rlp_encode_bytes(hp, hp_len, hp_rlp);

        /* RLP of child ref */
        uint8_t child_rlp[34];
        size_t child_rlp_len = ref_serialize(&nd->ext.child, child_rlp);

        size_t content_sz = hp_rlp_len + child_rlp_len;
        size_t overhead = rlp_list_overhead(content_sz);
        uint8_t *buf = malloc(overhead + content_sz);

        uint8_t *content = malloc(content_sz);
        memcpy(content, hp_rlp, hp_rlp_len);
        memcpy(content + hp_rlp_len, child_rlp, child_rlp_len);

        *out_len = rlp_encode_list(content, content_sz, buf);
        free(content);
        return buf;
    }

    if (nd->type == NODE_LEAF) {
        /* HP-encode the key suffix */
        uint8_t hp[34];
        size_t hp_len = hp_encode(nd->leaf.nibbles, nd->leaf.nlen, 1, hp);

        /* RLP of HP key */
        uint8_t hp_rlp[36];
        size_t hp_rlp_len = rlp_encode_bytes(hp, hp_len, hp_rlp);

        /* Value bytes are already serialized RLP */
        size_t content_sz = hp_rlp_len + nd->leaf.value_len;
        size_t overhead = rlp_list_overhead(content_sz);
        uint8_t *buf = malloc(overhead + content_sz);

        uint8_t *content = malloc(content_sz);
        memcpy(content, hp_rlp, hp_rlp_len);
        memcpy(content + hp_rlp_len, nd->leaf.value, nd->leaf.value_len);

        *out_len = rlp_encode_list(content, content_sz, buf);
        free(content);
        return buf;
    }

    /* fallback: empty */
    uint8_t *r = malloc(1);
    r[0] = 0x80;
    *out_len = 1;
    return r;
}

/* Encode node and create a ref (inline if < 32 bytes, hash otherwise). */
static node_ref_t encode_to_ref(mp_store_t *store, const mp_node_t *nd) {
    size_t rlp_len;
    uint8_t *rlp = encode_node(nd, &rlp_len);
    node_ref_t ref;
    if (rlp_len < 32) {
        ref.type = REF_INLINE;
        memcpy(ref.data, rlp, rlp_len);
        ref.data_len = (uint8_t)rlp_len;
    } else {
        ref.type = REF_HASH;
        ref.data_len = 32;
        mp_keccak256(ref.data, rlp, rlp_len);
        store_put(store, ref.data, rlp, rlp_len);
    }
    free(rlp);
    return ref;
}

/* Store a node and return its state root hash (always stores, for top-level). */
static void store_node(mp_store_t *store, const mp_node_t *nd,
                       uint8_t root_out[32]) {
    size_t rlp_len;
    uint8_t *rlp = encode_node(nd, &rlp_len);
    mp_keccak256(root_out, rlp, rlp_len);
    store_put(store, root_out, rlp, rlp_len);
    free(rlp);
}

/* ================================================================
 * SECTION 8: Node decoding (RLP bytes → mp_node_t)
 * ================================================================ */

static mp_node_t decode_rlp(const uint8_t *rlp, size_t rlp_len);

/* Decode a ref into a node_ref_t from an RLP item that appears as a child
 * in a branch node. The serialized bytes are [start..start+total). */
static node_ref_t decode_child_ref(const uint8_t *serial, size_t serial_len) {
    node_ref_t ref;
    /* Empty: single byte 0x80 (RLP empty string) or 0x00 (RLP scalar 0) */
    if (serial_len == 1 && (serial[0] == 0x80 || serial[0] == 0x00)) {
        ref.type = REF_EMPTY;
        ref.data_len = 0;
        return ref;
    }
    if (serial_len < 32) {
        ref.type = REF_INLINE;
        memcpy(ref.data, serial, serial_len);
        ref.data_len = (uint8_t)serial_len;
        return ref;
    }
    /* >= 32 bytes: must be a hash ref. Parse the RLP string to get the hash. */
    rlp_item_t it;
    rlp_decode_item(serial, serial_len, &it);
    ref.type = REF_HASH;
    memcpy(ref.data, it.content, 32);
    ref.data_len = 32;
    return ref;
}

static mp_node_t decode_rlp(const uint8_t *rlp, size_t rlp_len) {
    mp_node_t nd;
    memset(&nd, 0, sizeof(nd));

    rlp_item_t top;
    if (rlp_decode_item(rlp, rlp_len, &top) != 0) {
        nd.type = NODE_EMPTY;
        return nd;
    }

    /* Empty node: RLPString "" (\x80) or RLPScalar 0 (\x00) */
    if (!top.is_list) {
        if (top.clen == 0 || (top.clen == 1 && top.content[0] == 0)) {
            nd.type = NODE_EMPTY;
            return nd;
        }
        nd.type = NODE_EMPTY;
        return nd;
    }

    /* Count list elements */
    int elem_count = 0;
    {
        const uint8_t *p = top.content;
        size_t rem = top.clen;
        while (rem > 0) {
            rlp_item_t it;
            if (rlp_decode_item(p, rem, &it) != 0) break;
            elem_count++;
            p += it.total;
            rem -= it.total;
        }
    }

    if (elem_count == 17) {
        /* Branch node */
        nd.type = NODE_BRANCH;
        const uint8_t *p = top.content;
        size_t rem = top.clen;
        for (int i = 0; i < 17; i++) {
            rlp_item_t it;
            rlp_decode_item(p, rem, &it);
            if (i < 16) {
                nd.branch.children[i] = decode_child_ref(p, it.total);
            } else {
                /* Value slot */
                if ((it.total == 1 && (p[0] == 0x80 || p[0] == 0x00)) ||
                    (!it.is_list && it.clen == 0)) {
                    nd.branch.value = NULL;
                    nd.branch.value_len = 0;
                } else {
                    nd.branch.value = dup_bytes(p, it.total);
                    nd.branch.value_len = (uint32_t)it.total;
                }
            }
            p += it.total;
            rem -= it.total;
        }
        return nd;
    }

    if (elem_count == 2) {
        /* Shortcut node: extension or leaf */
        const uint8_t *p = top.content;
        size_t rem = top.clen;

        /* First element: HP-encoded key */
        rlp_item_t key_item;
        rlp_decode_item(p, rem, &key_item);
        uint8_t hp_nibbles[128];
        size_t hp_nlen;
        int is_leaf;
        hp_decode(key_item.content, key_item.clen, hp_nibbles, &hp_nlen, &is_leaf);

        p += key_item.total;
        rem -= key_item.total;

        /* Second element: value (leaf) or child ref (extension) */
        rlp_item_t val_item;
        rlp_decode_item(p, rem, &val_item);

        if (is_leaf) {
            nd.type = NODE_LEAF;
            nd.leaf.nibbles = dup_nibs(hp_nibbles, hp_nlen);
            nd.leaf.nlen = (uint16_t)hp_nlen;
            nd.leaf.value = dup_bytes(p, val_item.total);
            nd.leaf.value_len = (uint32_t)val_item.total;
        } else {
            nd.type = NODE_EXTENSION;
            nd.ext.nibbles = dup_nibs(hp_nibbles, hp_nlen);
            nd.ext.nlen = (uint16_t)hp_nlen;
            /* Child ref: check serialized size threshold */
            if (val_item.total < 32) {
                nd.ext.child.type = REF_INLINE;
                memcpy(nd.ext.child.data, p, val_item.total);
                nd.ext.child.data_len = (uint8_t)val_item.total;
                /* Check if it's actually an empty ref */
                if (val_item.total == 1 && (p[0] == 0x80 || p[0] == 0x00)) {
                    nd.ext.child.type = REF_EMPTY;
                    nd.ext.child.data_len = 0;
                }
            } else {
                nd.ext.child.type = REF_HASH;
                memcpy(nd.ext.child.data, val_item.content, 32);
                nd.ext.child.data_len = 32;
            }
        }
        return nd;
    }

    nd.type = NODE_EMPTY;
    return nd;
}

/* Load a node from a ref. */
static mp_node_t load_ref(mp_store_t *store, const node_ref_t *ref) {
    mp_node_t nd;
    memset(&nd, 0, sizeof(nd));
    switch (ref->type) {
        case REF_EMPTY:
            nd.type = NODE_EMPTY;
            return nd;
        case REF_INLINE:
            return decode_rlp(ref->data, ref->data_len);
        case REF_HASH: {
            size_t vlen;
            const uint8_t *data = store_get(store, ref->data, &vlen);
            if (!data) {
                nd.type = NODE_EMPTY;
                return nd;
            }
            return decode_rlp(data, vlen);
        }
    }
    nd.type = NODE_EMPTY;
    return nd;
}

/* ================================================================
 * SECTION 9: Trie get
 * ================================================================ */

static int trie_get_ref(mp_store_t *store, const node_ref_t *ref,
                        const uint8_t *key, size_t klen,
                        uint8_t **val_out, size_t *val_len_out);

/* val_out is callee-allocated (dup'd).  Caller must free with mp_free. */
static int trie_get_node(mp_store_t *store, const mp_node_t *nd,
                         const uint8_t *key, size_t klen,
                         uint8_t **val_out, size_t *val_len_out) {
    switch (nd->type) {
        case NODE_EMPTY:
            return 1; /* not found */

        case NODE_BRANCH:
            if (klen == 0) {
                if (nd->branch.value) {
                    *val_out = dup_bytes(nd->branch.value, nd->branch.value_len);
                    *val_len_out = nd->branch.value_len;
                    return 0;
                }
                return 1;
            }
            return trie_get_ref(store, &nd->branch.children[key[0]],
                                key + 1, klen - 1, val_out, val_len_out);

        case NODE_EXTENSION:
            if (nibs_is_prefix(nd->ext.nibbles, nd->ext.nlen, key, klen)) {
                return trie_get_ref(store, &nd->ext.child,
                                    key + nd->ext.nlen, klen - nd->ext.nlen,
                                    val_out, val_len_out);
            }
            return 1;

        case NODE_LEAF:
            if (nibs_equal(nd->leaf.nibbles, nd->leaf.nlen, key, klen)) {
                *val_out = dup_bytes(nd->leaf.value, nd->leaf.value_len);
                *val_len_out = nd->leaf.value_len;
                return 0;
            }
            return 1;
    }
    return 1;
}

static int trie_get_ref(mp_store_t *store, const node_ref_t *ref,
                        const uint8_t *key, size_t klen,
                        uint8_t **val_out, size_t *val_len_out) {
    mp_node_t nd = load_ref(store, ref);
    int rc = trie_get_node(store, &nd, key, klen, val_out, val_len_out);
    /* val_out is a fresh copy (dup'd in leaf/branch case), safe to free nd */
    free_node(&nd);
    return rc;
}

/* ================================================================
 * SECTION 10: Trie put
 * ================================================================ */

/* Forward declarations */
static mp_node_t put_node(mp_store_t *store, mp_node_t nd,
                          const uint8_t *key, size_t klen,
                          const uint8_t *val, size_t vlen,
                          int *existed);

/* Create a shortcut ref: if key is empty and the target is a ref, return it.
 * Otherwise create an extension or leaf. */
static node_ref_t new_shortcut(mp_store_t *store,
                               const uint8_t *nibs, size_t nlen,
                               int is_val,
                               node_ref_t child_ref,
                               const uint8_t *val, size_t vlen) {
    if (nlen == 0 && !is_val) {
        return child_ref;
    }
    mp_node_t nd;
    memset(&nd, 0, sizeof(nd));
    if (is_val) {
        nd.type = NODE_LEAF;
        nd.leaf.nibbles = dup_nibs(nibs, nlen);
        nd.leaf.nlen = (uint16_t)nlen;
        nd.leaf.value = dup_bytes(val, vlen);
        nd.leaf.value_len = (uint32_t)vlen;
    } else {
        nd.type = NODE_EXTENSION;
        nd.ext.nibbles = dup_nibs(nibs, nlen);
        nd.ext.nlen = (uint16_t)nlen;
        nd.ext.child = child_ref;
    }
    node_ref_t ref = encode_to_ref(store, &nd);
    free_node(&nd);
    return ref;
}

/* Put a key-value into the node at the given ref. Returns the new ref. */
static node_ref_t put_ref(mp_store_t *store, node_ref_t ref,
                          const uint8_t *key, size_t klen,
                          const uint8_t *val, size_t vlen,
                          int *existed) {
    mp_node_t nd = load_ref(store, &ref);
    mp_node_t result = put_node(store, nd, key, klen, val, vlen, existed);
    node_ref_t new_ref = encode_to_ref(store, &result);
    free_node(&result);
    return new_ref;
}

static mp_node_t put_node(mp_store_t *store, mp_node_t nd,
                          const uint8_t *key, size_t klen,
                          const uint8_t *val, size_t vlen,
                          int *existed) {
    mp_node_t result;
    memset(&result, 0, sizeof(result));

    switch (nd.type) {

    case NODE_EMPTY:
        /* Create a leaf */
        result.type = NODE_LEAF;
        result.leaf.nibbles = dup_nibs(key, klen);
        result.leaf.nlen = (uint16_t)klen;
        result.leaf.value = dup_bytes(val, vlen);
        result.leaf.value_len = (uint32_t)vlen;
        *existed = 0;
        free_node(&nd);
        return result;

    case NODE_BRANCH: {
        if (klen == 0) {
            /* Replace value at this branch */
            result.type = NODE_BRANCH;
            memcpy(result.branch.children, nd.branch.children,
                   sizeof(nd.branch.children));
            result.branch.value = dup_bytes(val, vlen);
            result.branch.value_len = (uint32_t)vlen;
            *existed = (nd.branch.value != NULL);
            free(nd.branch.value);
            nd.branch.value = NULL;
            nd.type = NODE_EMPTY; /* prevent double-free of children */
            return result;
        }
        uint8_t idx = key[0];
        if (is_empty_ref(&nd.branch.children[idx])) {
            /* Create shortcut in empty slot */
            node_ref_t tail = new_shortcut(store,
                                           key + 1, klen - 1,
                                           1, empty_ref(), val, vlen);
            result.type = NODE_BRANCH;
            memcpy(result.branch.children, nd.branch.children,
                   sizeof(nd.branch.children));
            result.branch.children[idx] = tail;
            result.branch.value = dup_bytes(nd.branch.value, nd.branch.value_len);
            result.branch.value_len = nd.branch.value_len;
            *existed = 0;
            free_node(&nd);
            return result;
        } else {
            /* Recurse into existing child */
            node_ref_t new_child = put_ref(store,
                                           nd.branch.children[idx],
                                           key + 1, klen - 1,
                                           val, vlen, existed);
            result.type = NODE_BRANCH;
            memcpy(result.branch.children, nd.branch.children,
                   sizeof(nd.branch.children));
            result.branch.children[idx] = new_child;
            result.branch.value = dup_bytes(nd.branch.value, nd.branch.value_len);
            result.branch.value_len = nd.branch.value_len;
            free_node(&nd);
            return result;
        }
    }

    case NODE_LEAF:
    case NODE_EXTENSION: {
        int is_ext = (nd.type == NODE_EXTENSION);
        uint8_t *nd_nibs = is_ext ? nd.ext.nibbles : nd.leaf.nibbles;
        size_t nd_nlen   = is_ext ? nd.ext.nlen    : nd.leaf.nlen;

        /* Case 1: key == node key */
        if (nibs_equal(key, klen, nd_nibs, nd_nlen)) {
            if (!is_ext) {
                /* Leaf: replace value */
                result.type = NODE_LEAF;
                result.leaf.nibbles = dup_nibs(key, klen);
                result.leaf.nlen = (uint16_t)klen;
                result.leaf.value = dup_bytes(val, vlen);
                result.leaf.value_len = (uint32_t)vlen;
                *existed = 1;
                free_node(&nd);
                return result;
            } else {
                /* Extension: recurse into child with full key
                 * (matches Haskell behavior exactly) */
                node_ref_t new_child = put_ref(store, nd.ext.child,
                                               key, klen,
                                               val, vlen, existed);
                result.type = NODE_EXTENSION;
                result.ext.nibbles = dup_nibs(nd_nibs, nd_nlen);
                result.ext.nlen = (uint16_t)nd_nlen;
                result.ext.child = new_child;
                free_node(&nd);
                return result;
            }
        }

        /* Case 2: key is empty */
        if (klen == 0) {
            node_ref_t old_shortcut = new_shortcut(store,
                nd_nibs + 1, nd_nlen - 1,
                !is_ext,
                is_ext ? nd.ext.child : empty_ref(),
                is_ext ? NULL : nd.leaf.value,
                is_ext ? 0 : nd.leaf.value_len);

            result.type = NODE_BRANCH;
            for (int i = 0; i < 16; i++)
                result.branch.children[i] = empty_ref();
            result.branch.children[nd_nibs[0]] = old_shortcut;
            result.branch.value = dup_bytes(val, vlen);
            result.branch.value_len = (uint32_t)vlen;
            *existed = 0;
            free_node(&nd);
            return result;
        }

        /* Case 3: key is prefix of node key */
        if (nibs_is_prefix(key, klen, nd_nibs, nd_nlen) && klen < nd_nlen) {
            node_ref_t tail = new_shortcut(store,
                nd_nibs + klen, nd_nlen - klen,
                !is_ext,
                is_ext ? nd.ext.child : empty_ref(),
                is_ext ? NULL : nd.leaf.value,
                is_ext ? 0 : nd.leaf.value_len);
            int ex2 = 0;
            node_ref_t modified = put_ref(store, tail,
                                          (const uint8_t*)"", 0,
                                          val, vlen, &ex2);
            result.type = NODE_EXTENSION;
            result.ext.nibbles = dup_nibs(key, klen);
            result.ext.nlen = (uint16_t)klen;
            result.ext.child = modified;
            *existed = ex2;
            free_node(&nd);
            return result;
        }

        /* Case 4: node key is prefix of key */
        if (nibs_is_prefix(nd_nibs, nd_nlen, key, klen) && nd_nlen < klen) {
            if (!is_ext) {
                /* Leaf value exists at nd_nibs; re-insert around new key.
                 * Matches Haskell: putKV_NodeData key2 val (ShortcutNodeData key1 (Right val1)) */
                mp_node_t new_leaf;
                new_leaf.type = NODE_LEAF;
                new_leaf.leaf.nibbles = dup_nibs(key, klen);
                new_leaf.leaf.nlen = (uint16_t)klen;
                new_leaf.leaf.value = dup_bytes(val, vlen);
                new_leaf.leaf.value_len = (uint32_t)vlen;

                int ex2;
                mp_node_t re = put_node(store, new_leaf,
                                        nd_nibs, nd_nlen,
                                        nd.leaf.value, nd.leaf.value_len,
                                        &ex2);
                *existed = 0;
                free_node(&nd);
                return re;
            } else {
                /* Extension: recurse into child with remaining key */
                node_ref_t new_child = put_ref(store, nd.ext.child,
                    key + nd_nlen, klen - nd_nlen,
                    val, vlen, existed);
                result.type = NODE_EXTENSION;
                result.ext.nibbles = dup_nibs(nd_nibs, nd_nlen);
                result.ext.nlen = (uint16_t)nd_nlen;
                result.ext.child = new_child;
                free_node(&nd);
                return result;
            }
        }

        /* Case 5: common prefix exists (heads match) */
        size_t cplen = nibs_common_len(key, klen, nd_nibs, nd_nlen);
        if (cplen > 0) {
            node_ref_t before_put = new_shortcut(store,
                nd_nibs + cplen, nd_nlen - cplen,
                !is_ext,
                is_ext ? nd.ext.child : empty_ref(),
                is_ext ? NULL : nd.leaf.value,
                is_ext ? 0 : nd.leaf.value_len);

            node_ref_t after_put = put_ref(store, before_put,
                key + cplen, klen - cplen,
                val, vlen, existed);

            result.type = NODE_EXTENSION;
            result.ext.nibbles = dup_nibs(key, cplen);
            result.ext.nlen = (uint16_t)cplen;
            result.ext.child = after_put;
            free_node(&nd);
            return result;
        }

        /* Case 6: completely different keys */
        {
            node_ref_t tail1 = new_shortcut(store,
                key + 1, klen - 1, 1, empty_ref(), val, vlen);
            node_ref_t tail2 = new_shortcut(store,
                nd_nibs + 1, nd_nlen - 1,
                !is_ext,
                is_ext ? nd.ext.child : empty_ref(),
                is_ext ? NULL : nd.leaf.value,
                is_ext ? 0 : nd.leaf.value_len);

            result.type = NODE_BRANCH;
            for (int i = 0; i < 16; i++)
                result.branch.children[i] = empty_ref();
            result.branch.children[key[0]] = tail1;
            result.branch.children[nd_nibs[0]] = tail2;
            result.branch.value = NULL;
            result.branch.value_len = 0;
            *existed = 0;
            free_node(&nd);
            return result;
        }
    }

    default:
        *existed = 0;
        free_node(&nd);
        return result;
    }
}

/* ================================================================
 * SECTION 11: Trie delete + simplify
 * ================================================================ */

static mp_node_t simplify(mp_store_t *store, mp_node_t nd);

static mp_node_t delete_node(mp_store_t *store, mp_node_t nd,
                             const uint8_t *key, size_t klen);

static node_ref_t delete_ref(mp_store_t *store, node_ref_t ref,
                             const uint8_t *key, size_t klen) {
    mp_node_t nd = load_ref(store, &ref);
    mp_node_t result = delete_node(store, nd, key, klen);
    node_ref_t new_ref = encode_to_ref(store, &result);
    free_node(&result);
    return new_ref;
}

static mp_node_t delete_node(mp_store_t *store, mp_node_t nd,
                             const uint8_t *key, size_t klen) {
    mp_node_t result;
    memset(&result, 0, sizeof(result));

    switch (nd.type) {

    case NODE_EMPTY:
        return nd; /* nothing to delete */

    case NODE_BRANCH: {
        if (klen == 0) {
            /* Delete value at this branch */
            result.type = NODE_BRANCH;
            memcpy(result.branch.children, nd.branch.children,
                   sizeof(nd.branch.children));
            result.branch.value = NULL;
            result.branch.value_len = 0;
            free(nd.branch.value);
            nd.branch.value = NULL;
            nd.type = NODE_EMPTY;
            return simplify(store, result);
        }
        uint8_t idx = key[0];
        if (is_empty_ref(&nd.branch.children[idx])) {
            return nd; /* key not present */
        }
        node_ref_t new_child = delete_ref(store,
                                          nd.branch.children[idx],
                                          key + 1, klen - 1);
        result.type = NODE_BRANCH;
        memcpy(result.branch.children, nd.branch.children,
               sizeof(nd.branch.children));
        result.branch.children[idx] = new_child;
        result.branch.value = dup_bytes(nd.branch.value, nd.branch.value_len);
        result.branch.value_len = nd.branch.value_len;
        free_node(&nd);
        return simplify(store, result);
    }

    case NODE_LEAF:
        if (nibs_equal(key, klen, nd.leaf.nibbles, nd.leaf.nlen)) {
            free_node(&nd);
            result.type = NODE_EMPTY;
            return result;
        }
        return nd; /* key not present */

    case NODE_EXTENSION:
        if (nibs_is_prefix(nd.ext.nibbles, nd.ext.nlen, key, klen)) {
            node_ref_t new_child = delete_ref(store, nd.ext.child,
                key + nd.ext.nlen, klen - nd.ext.nlen);
            result.type = NODE_EXTENSION;
            result.ext.nibbles = dup_nibs(nd.ext.nibbles, nd.ext.nlen);
            result.ext.nlen = nd.ext.nlen;
            result.ext.child = new_child;
            free_node(&nd);
            return simplify(store, result);
        }
        return nd; /* key not present */

    default:
        return nd;
    }
}

static mp_node_t simplify(mp_store_t *store, mp_node_t nd) {
    if (nd.type == NODE_EXTENSION) {
        mp_node_t child = load_ref(store, &nd.ext.child);
        if (child.type == NODE_EXTENSION) {
            /* Merge extension + extension */
            mp_node_t merged;
            merged.type = NODE_EXTENSION;
            merged.ext.nlen = nd.ext.nlen + child.ext.nlen;
            merged.ext.nibbles = malloc(merged.ext.nlen);
            memcpy(merged.ext.nibbles, nd.ext.nibbles, nd.ext.nlen);
            memcpy(merged.ext.nibbles + nd.ext.nlen,
                   child.ext.nibbles, child.ext.nlen);
            merged.ext.child = child.ext.child;
            child.ext.nibbles = NULL; /* prevent double-free */
            free_node(&child);
            free_node(&nd);
            return merged;
        }
        if (child.type == NODE_LEAF) {
            /* Merge extension + leaf */
            mp_node_t merged;
            merged.type = NODE_LEAF;
            merged.leaf.nlen = nd.ext.nlen + child.leaf.nlen;
            merged.leaf.nibbles = malloc(merged.leaf.nlen);
            memcpy(merged.leaf.nibbles, nd.ext.nibbles, nd.ext.nlen);
            memcpy(merged.leaf.nibbles + nd.ext.nlen,
                   child.leaf.nibbles, child.leaf.nlen);
            merged.leaf.value = child.leaf.value;
            merged.leaf.value_len = child.leaf.value_len;
            child.leaf.value = NULL;
            child.leaf.nibbles = NULL;
            free_node(&child);
            free_node(&nd);
            return merged;
        }
        free_node(&child);
        return nd;
    }

    if (nd.type == NODE_BRANCH && nd.branch.value == NULL) {
        int count = 0;
        int single_idx = -1;
        for (int i = 0; i < 16; i++) {
            if (!is_empty_ref(&nd.branch.children[i])) {
                count++;
                single_idx = i;
            }
        }
        if (count == 1) {
            /* Convert to extension with single nibble prefix */
            mp_node_t ext;
            ext.type = NODE_EXTENSION;
            ext.ext.nibbles = malloc(1);
            ext.ext.nibbles[0] = (uint8_t)single_idx;
            ext.ext.nlen = 1;
            ext.ext.child = nd.branch.children[single_idx];
            nd.branch.children[single_idx] = empty_ref();
            free_node(&nd);
            return simplify(store, ext);
        }
    }

    return nd;
}

/* ================================================================
 * SECTION 12: Public API
 *
 * Every entry point takes the store lock, evicts if the cache is full,
 * clears the missing-node flag, runs, and reports MP_ERR_MISSING if the
 * operation needed a node nobody has.
 * ================================================================ */

mp_store_t *mp_db_open(void *ldb, uint32_t capacity, uint32_t flush_every) {
    mp_store_t *s = calloc(1, sizeof(mp_store_t));
    if (!s) return NULL;
    s->capacity = STORE_INIT_CAP;
    s->entries = calloc(s->capacity, sizeof(store_entry_t));
    if (!s->entries) { free(s); return NULL; }
    s->ldb = (leveldb_t *)ldb;
    s->max_evictable = s->ldb ? capacity : UINT32_MAX;
    s->flush_every = flush_every ? flush_every : 1;
    if (s->ldb) {
        s->ro = leveldb_readoptions_create();
        s->wo = leveldb_writeoptions_create();
    }
    pthread_mutex_init(&s->lock, NULL);
    return s;
}

void mp_db_close(mp_store_t *s) {
    if (!s) return;
    store_flush(s);
    for (uint32_t i = 0; i < s->capacity; i++) {
        if (s->entries[i].state >= ENTRY_CLEAN) free(s->entries[i].value);
    }
    free(s->entries);
    free(s->pending);
    if (s->ro) leveldb_readoptions_destroy(s->ro);
    if (s->wo) leveldb_writeoptions_destroy(s->wo);
    pthread_mutex_destroy(&s->lock);
    free(s);
}

static void op_begin(mp_store_t *s) {
    pthread_mutex_lock(&s->lock);
    store_maybe_evict(s);
    s->missing = 0;
}

static int op_end(mp_store_t *s, int rc) {
    if (s->missing) rc = MP_ERR_MISSING;
    pthread_mutex_unlock(&s->lock);
    return rc;
}

static void key_nibbles(const uint8_t *key, size_t key_len, uint8_t nibs[64]) {
    uint8_t h[32];
    mp_keccak256(h, key, key_len);
    bytes_to_nibbles(h, nibs);
}

/* Decode the root node; 0 on success, -1 if the root is missing. */
static int load_root(mp_store_t *s, const uint8_t root[32], mp_node_t *out) {
    size_t len;
    const uint8_t *rlp = store_get(s, root, &len);
    if (!rlp) return -1;
    *out = decode_rlp(rlp, len);
    return 0;
}

int mp_db_get(mp_store_t *s, const uint8_t root[32],
              const uint8_t *key, size_t key_len,
              uint8_t **val_out, size_t *val_len_out) {
    op_begin(s);
    *val_out = NULL;
    *val_len_out = 0;
    mp_node_t root_nd;
    if (load_root(s, root, &root_nd) != 0) return op_end(s, -1);

    uint8_t nibs[64];
    key_nibbles(key, key_len, nibs);
    uint8_t *v = NULL;
    size_t vlen = 0;
    int rc = trie_get_node(s, &root_nd, nibs, 64, &v, &vlen);
    free_node(&root_nd);
    if (s->missing) { free(v); return op_end(s, rc); }
    if (rc == 0) { *val_out = v; *val_len_out = vlen; }
    return op_end(s, rc);
}

int mp_db_put_many(mp_store_t *s, const uint8_t root[32], size_t count,
                   const uint8_t **keys, const size_t *key_lens,
                   const uint8_t **vals, const size_t *val_lens,
                   uint8_t new_root[32], uint8_t *existed_out) {
    op_begin(s);
    mp_node_t nd;
    if (load_root(s, root, &nd) != 0) return op_end(s, -1);

    for (size_t i = 0; i < count && !s->missing; i++) {
        uint8_t nibs[64];
        key_nibbles(keys[i], key_lens[i], nibs);
        int ex = 0;
        nd = put_node(s, nd, nibs, 64, vals[i], val_lens[i], &ex);
        if (existed_out) existed_out[i] = (uint8_t)ex;
    }
    if (!s->missing) store_node(s, &nd, new_root);
    free_node(&nd);
    return op_end(s, 0);
}

int mp_db_delete(mp_store_t *s, const uint8_t root[32],
                 const uint8_t *key, size_t key_len,
                 uint8_t new_root[32]) {
    op_begin(s);
    mp_node_t nd;
    if (load_root(s, root, &nd) != 0) return op_end(s, -1);

    uint8_t nibs[64];
    key_nibbles(key, key_len, nibs);
    nd = delete_node(s, nd, nibs, 64);
    if (!s->missing) store_node(s, &nd, new_root);
    free_node(&nd);
    return op_end(s, 0);
}

int mp_db_tick(mp_store_t *s) {
    pthread_mutex_lock(&s->lock);
    int rc = 0;
    if (++s->ticks >= s->flush_every) {
        rc = store_flush(s);
        s->ticks = 0;
    }
    pthread_mutex_unlock(&s->lock);
    return rc;
}

int mp_db_flush(mp_store_t *s) {
    pthread_mutex_lock(&s->lock);
    int rc = store_flush(s);
    s->ticks = 0;
    pthread_mutex_unlock(&s->lock);
    return rc;
}

int mp_db_node_get(mp_store_t *s, const uint8_t hash[32],
                   uint8_t **data_out, size_t *data_len_out) {
    op_begin(s);
    size_t len;
    const uint8_t *v = store_get(s, hash, &len);
    if (!v) { s->missing = 0; return op_end(s, 1); }
    *data_out = dup_bytes(v, len);
    *data_len_out = len;
    return op_end(s, 0);
}

int mp_db_node_put(mp_store_t *s, const uint8_t hash[32],
                   const uint8_t *data, size_t data_len) {
    op_begin(s);
    store_put(s, hash, data, data_len);
    return op_end(s, 0);
}

int mp_db_node_delete(mp_store_t *s, const uint8_t hash[32]) {
    pthread_mutex_lock(&s->lock);
    store_entry_t *e = store_find(s, hash);
    if (e) {
        if (e->state == ENTRY_PENDING) {
            for (uint32_t i = 0; i < s->pending_count; i++)
                if (memcmp(s->pending[i], hash, 32) == 0) {
                    memcpy(s->pending[i], s->pending[--s->pending_count], 32);
                    break;
                }
        } else {
            s->evictable--;
        }
        free(e->value);
        e->value = NULL;
        e->state = SLOT_TOMB;
        s->count--;
        s->tombs++;
    }
    if (s->ldb) {
        char *err = NULL;
        leveldb_delete(s->ldb, s->wo, (const char *)hash, 32, &err);
        if (err) leveldb_free(err);
    }
    pthread_mutex_unlock(&s->lock);
    return 0;
}

void mp_db_overlay_begin(mp_store_t *s) {
    pthread_mutex_lock(&s->lock);
    s->overlay_depth++;
    pthread_mutex_unlock(&s->lock);
}

void mp_db_overlay_end(mp_store_t *s) {
    pthread_mutex_lock(&s->lock);
    if (s->overlay_depth > 0) s->overlay_depth--;
    pthread_mutex_unlock(&s->lock);
}

void mp_db_missing_hash(const mp_store_t *s, uint8_t hash_out[32]) {
    memcpy(hash_out, s->missing_hash, 32);
}

void mp_free(void *ptr) {
    free(ptr);
}
