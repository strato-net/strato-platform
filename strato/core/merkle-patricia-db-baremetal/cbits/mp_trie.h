#ifndef MP_TRIE_H
#define MP_TRIE_H

#include <stdint.h>
#include <stddef.h>

/* A Merkle Patricia trie whose nodes live in a C-owned cache in front of
 * LevelDB.  Haskell passes a state root and raw key/value bytes; everything
 * else (hashing, node encoding, caching, reads and writes of nodes) is here.
 *
 * Return codes: 0 ok, 1 not found (get only), MP_ERR_MISSING when a node
 * referenced by the trie is neither cached nor in LevelDB (see
 * mp_db_missing_hash), other negatives on error. */

#define MP_ERR_MISSING (-2)

typedef struct mp_store mp_store_t;

/* ldb is a leveldb_t* (may be NULL for a purely in-memory store that never
 * evicts).  capacity bounds the number of clean cached nodes; pending writes
 * are written through every flush_every ticks. */
mp_store_t *mp_db_open(void *ldb, uint32_t capacity, uint32_t flush_every);
void mp_db_close(mp_store_t *db);

void mp_empty_root(uint8_t root_out[32]);

/* Keys are raw key bytes; the trie key is keccak256(key). Values are the
 * caller's already-serialized bytes. */
int mp_db_get_key_val(mp_store_t *db, const uint8_t root[32],
              const uint8_t *key, size_t key_len,
              uint8_t **val_out, size_t *val_len_out);

int mp_db_put_many_key_val(mp_store_t *db, const uint8_t root[32], size_t count,
                   const uint8_t **keys, const size_t *key_lens,
                   const uint8_t **vals, const size_t *val_lens,
                   uint8_t new_root[32], uint8_t *existed_out);

int mp_db_delete_key(mp_store_t *db, const uint8_t root[32],
                 const uint8_t *key, size_t key_len,
                 uint8_t new_root[32]);

/* A block is done / write everything pending now. */
int mp_db_tick(mp_store_t *db);
int mp_db_flush(mp_store_t *db);

/* Raw node access by hash, for the few readers that walk nodes themselves.
 * node_get returns a copy the caller frees with mp_free. */
int mp_db_lookup_node(mp_store_t *db, const uint8_t hash[32],
                   uint8_t **data_out, size_t *data_len_out);
int mp_db_insert_node(mp_store_t *db, const uint8_t hash[32],
                   const uint8_t *data, size_t data_len);
int mp_db_delete_node(mp_store_t *db, const uint8_t hash[32]);

/* Walkers. Callbacks return 0 to
 * continue, non-zero to stop the walk; that value is returned. Keys are
 * passed as nibbles (one per byte). */

/* forEach: every key/value under root. */
typedef int (*mp_kv_fn)(void *ctx, const uint8_t *key_nibs, size_t key_nlen,
                        const uint8_t *val, size_t val_len);
int mp_db_for_each(mp_store_t *db, const uint8_t root[32],
                   mp_kv_fn fn, void *ctx);

/* dbDiff: the changes from the trie at root_a to the trie at root_b.
 * op: 0 create (old NULL), 1 update, 2 delete (new NULL). */
typedef int (*mp_diff_fn)(void *ctx, int op,
                          const uint8_t *key_nibs, size_t key_nlen,
                          const uint8_t *old_val, size_t old_len,
                          const uint8_t *new_val, size_t new_len);
int mp_db_diff(mp_store_t *db, const uint8_t root_a[32], const uint8_t root_b[32],
               mp_diff_fn fn, void *ctx);

/* getProof: walk root along a pre-encoded (unhashed) key, handing each
 * hashed node's RLP to fn in root-to-leaf order. val_out is the value at
 * the key (caller frees with mp_free) or NULL when absent. */
typedef int (*mp_bytes_fn)(void *ctx, const uint8_t *data, size_t data_len);
int mp_db_get_proof(mp_store_t *db, const uint8_t root[32],
                    const uint8_t *key, size_t key_len,
                    mp_bytes_fn fn, void *ctx,
                    uint8_t **val_out, size_t *val_len_out);

/* Fetcher for nodes the store lacks: asked for hash, returns 0 and a
 * malloc'd copy of the node's RLP in *data_out (the store frees it), or
 * 1 when nobody has it, negative on failure. fn NULL clears. */
typedef int (*mp_fetch_fn)(void *ctx, const uint8_t hash[32],
                           uint8_t **data_out, size_t *data_len_out);
void mp_db_set_fetcher(mp_store_t *db, mp_fetch_fn fn, void *ctx);

/* Sandbox: while depth > 0 new nodes are scratch, never written through. */
void mp_db_overlay_begin(mp_store_t *db);
void mp_db_overlay_end(mp_store_t *db);

/* Hash of the node whose absence caused the last MP_ERR_MISSING. */
void mp_db_missing_hash(const mp_store_t *db, uint8_t hash_out[32]);

/* Last operation's error; valid until the next operation on this store. */
const char *mp_db_error(const mp_store_t *db);

void mp_free(void *ptr);

#endif
