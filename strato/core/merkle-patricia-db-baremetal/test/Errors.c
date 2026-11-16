/* Run from the repo root:
 * make -f strato/core/merkle-patricia-db-baremetal/test/errors.mk test
 * The injected failures use the real trie and a real LevelDB. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <leveldb/c.h>

static int fail_read, fail_write, fail_delete;
static char *test_get(leveldb_t *, const leveldb_readoptions_t *, const char *, size_t, size_t *, char **);
static void test_write(leveldb_t *, const leveldb_writeoptions_t *, leveldb_writebatch_t *, char **);
static void test_delete(leveldb_t *, const leveldb_writeoptions_t *, const char *, size_t, char **);
#define leveldb_get test_get
#define leveldb_write test_write
#define leveldb_delete test_delete
#include "../cbits/mp_trie.c"
#undef leveldb_get
#undef leveldb_write
#undef leveldb_delete

static char *test_get(leveldb_t *db, const leveldb_readoptions_t *opts,
                      const char *key, size_t n, size_t *len, char **err) {
    if (fail_read) { *err = strdup("injected read failure"); return NULL; }
    return leveldb_get(db, opts, key, n, len, err);
}
static void test_write(leveldb_t *db, const leveldb_writeoptions_t *opts,
                        leveldb_writebatch_t *batch, char **err) {
    if (fail_write) { *err = strdup("injected write failure"); return; }
    leveldb_write(db, opts, batch, err);
}
static void test_delete(leveldb_t *db, const leveldb_writeoptions_t *opts,
                         const char *key, size_t n, char **err) {
    if (fail_delete) { *err = strdup("injected delete failure"); return; }
    leveldb_delete(db, opts, key, n, err);
}
static int proof_node(void *ctx, const uint8_t *bytes, size_t n) {
    (void)ctx; (void)bytes; (void)n;
    return 0;
}
static int fetch_failure(void *ctx, const uint8_t hash[32], uint8_t **out, size_t *n) {
    (void)ctx; (void)hash; (void)out; (void)n;
    return -1;
}
static int fetch_absent(void *ctx, const uint8_t hash[32], uint8_t **out, size_t *n) {
    (void)ctx; (void)hash; (void)out; (void)n;
    return 1;
}
int main(void) {
    char path[] = "/tmp/mp-errors-XXXXXX";
    assert(mkdtemp(path));
    leveldb_options_t *opts = leveldb_options_create();
    leveldb_options_set_create_if_missing(opts, 1);
    char *err = NULL;
    leveldb_t *db = leveldb_open(opts, path, &err);
    assert(db && !err);
    mp_store_t *s = mp_db_open(db, 50, 2);
    uint8_t empty[32], unknown[32] = {1}, root[32];
    mp_empty_root(empty);
    uint8_t *value; size_t len;

    fail_read = 1;
    assert(mp_db_get_key_val(s, unknown, (const uint8_t *)"k", 1, &value, &len) == -1);
    assert(strstr(mp_db_error(s), "injected read failure"));
    assert(mp_db_lookup_node(s, unknown, &value, &len) == -1);
    assert(strstr(mp_db_error(s), "injected read failure"));
    fail_read = 0;
    assert(mp_db_get_key_val(s, unknown, (const uint8_t *)"k", 1, &value, &len) == MP_ERR_MISSING);
    assert(!mp_db_error(s));
    assert(mp_db_get_proof(s, unknown, (const uint8_t *)"k", 1, proof_node, NULL, &value, &len) == MP_ERR_MISSING);

    mp_db_set_fetcher(s, fetch_failure, NULL);
    assert(mp_db_get_key_val(s, unknown, (const uint8_t *)"k", 1, &value, &len) == -1);
    assert(strstr(mp_db_error(s), "callback failed"));
    mp_db_set_fetcher(s, fetch_absent, NULL);
    assert(mp_db_get_key_val(s, unknown, (const uint8_t *)"k", 1, &value, &len) == MP_ERR_MISSING);
    mp_db_set_fetcher(s, NULL, NULL);

    /* Invalid RLP, arity, path length, child hash and overflowing length. */
    const uint8_t malformed[][12] = {
        {0xff}, {0xc1,0x80}, {0xc2,0x80,0x80}, {0xc3,0x10,0x81,0x22},
        {0xbf,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff}, {0x80,0x80}
    };
    const size_t lengths[] = {1,2,3,4,9,2};
    for (size_t i = 0; i < sizeof(lengths)/sizeof(*lengths); i++) {
        assert(mp_db_insert_node(s, unknown, malformed[i], lengths[i]) == 0);
        assert(mp_db_get_key_val(s, unknown, (const uint8_t *)"k", 1, &value, &len) == -1);
        assert(strstr(mp_db_error(s), "decode trie node 01"));
        assert(mp_db_delete_node(s, unknown) == 0);
    }
    uint8_t long_path[70] = {0xf8, 68, 0xb8, 65, 0x20};
    long_path[69] = 0x80;
    assert(mp_db_insert_node(s, unknown, long_path, sizeof(long_path)) == 0);
    assert(mp_db_get_key_val(s, unknown, (const uint8_t *)"k", 1, &value, &len) == -1);
    assert(strstr(mp_db_error(s), "path length"));
    assert(mp_db_delete_node(s, unknown) == 0);

    /* Legacy blank-root encoding is valid, but other empty nodes are not. */
    leveldb_put(db, s->wo, (const char *)empty, 32, "", 0, &err);
    assert(!err);
    assert(mp_db_get_key_val(s, empty, (const uint8_t *)"k", 1, &value, &len) == 1);
    const uint8_t *keys[] = {(const uint8_t *)"k"};
    const uint8_t *vals[] = {(const uint8_t *)"v"};
    size_t sizes[] = {1};
    assert(mp_db_put_many_key_val(s, empty, 1, keys, sizes, vals, sizes, root, NULL) == 0);
    uint32_t pending = s->pending_count;
    assert(pending > 0);
    fail_write = 1;
    assert(mp_db_flush(s) == -1);
    assert(strstr(mp_db_error(s), "injected write failure"));
    assert(s->pending_count == pending);
    assert(store_find(s, root)->state == ENTRY_PENDING);
    fail_write = 0;
    assert(mp_db_flush(s) == 0);
    assert(s->pending_count == 0);
    assert(store_find(s, root)->state == ENTRY_CLEAN);

    fail_delete = 1;
    assert(mp_db_delete_node(s, root) == -1);
    assert(strstr(mp_db_error(s), "injected delete failure"));
    assert(store_find(s, root));
    fail_delete = 0;
    mp_db_close(s);
    s = mp_db_open(db, 50, 2);
    assert(mp_db_get_key_val(s, root, keys[0], 1, &value, &len) == 0);
    assert(len == 1 && *value == 'v');
    mp_free(value);
    mp_db_close(s);
    leveldb_close(db);
    leveldb_destroy_db(opts, path, &err);
    assert(!err);
    leveldb_options_destroy(opts);
    puts("PASS: storage failures, decode errors, fetch failures, missing proofs, retry and cold reopen");
    return 0;
}
