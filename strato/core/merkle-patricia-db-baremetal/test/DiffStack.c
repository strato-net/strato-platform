#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "../cbits/mp_trie.c"

static int changes;
static int expected_kind = 1;
static int callback_result;
static uint8_t expected_key[64];
static int changed(void *ctx, int kind, const uint8_t *key, size_t key_len,
                   const uint8_t *before, size_t before_len,
                   const uint8_t *after, size_t after_len) {
    (void)ctx;
    assert(kind == expected_kind && key_len == 64);
    assert(memcmp(key, expected_key, key_len) == 0);
    if (kind == 0) assert(before_len == 0 && before == NULL);
    else assert(before_len == 1 && before[0] == 'a');
    if (kind == 2) assert(after_len == 0 && after == NULL);
    else assert(after_len == 1 && after[0] == (kind == 0 ? 'a' : 'b'));
    changes++;
    return callback_result;
}

static void *small_stack_diff(void *unused) {
    (void)unused;
    char path[] = "/tmp/mp-diff-stack-XXXXXX";
    assert(mkdtemp(path));
    leveldb_options_t *options = leveldb_options_create();
    leveldb_options_set_create_if_missing(options, 1);
    char *error = NULL;
    leveldb_t *database = leveldb_open(options, path, &error);
    assert(database && !error);
    mp_store_t *store = mp_db_open(database, 50, 2);
    uint8_t empty[32], first[32], second[32], key[32];
    memset(key, 0x11, sizeof(key));
    uint8_t key_hash[32];
    mp_keccak256(key_hash, key, sizeof(key));
    for (size_t i = 0; i < sizeof(key_hash); i++) {
        expected_key[2 * i] = key_hash[i] >> 4;
        expected_key[2 * i + 1] = key_hash[i] & 15;
    }
    mp_empty_root(empty);
    const uint8_t *keys[] = {key};
    const uint8_t *old_values[] = {(const uint8_t *)"a"};
    const uint8_t *new_values[] = {(const uint8_t *)"b"};
    size_t key_lengths[] = {sizeof(key)}, value_lengths[] = {1};
    assert(mp_db_put_many_key_val(store, empty, 1, keys, key_lengths, old_values, value_lengths, first, NULL) == 0);
    assert(mp_db_put_many_key_val(store, first, 1, keys, key_lengths, new_values, value_lengths, second, NULL) == 0);
    assert(mp_db_diff(store, first, second, changed, NULL) == 0);
    assert(changes == 1);
    assert(mp_db_diff(store, first, first, changed, NULL) == 0);
    assert(changes == 1);
    callback_result = 7;
    assert(mp_db_diff(store, first, second, changed, NULL) == 7);
    assert(changes == 2);
    callback_result = 0;
    expected_kind = 0;
    assert(mp_db_diff(store, empty, first, changed, NULL) == 0);
    assert(changes == 3);
    expected_kind = 2;
    assert(mp_db_diff(store, first, empty, changed, NULL) == 0);
    assert(changes == 4);
    mp_db_close(store);
    leveldb_close(database);
    leveldb_destroy_db(options, path, &error);
    assert(!error);
    leveldb_options_destroy(options);
    return NULL;
}

int main(void) {
    pthread_attr_t attributes;
    pthread_t thread;
    assert(pthread_attr_init(&attributes) == 0);
    assert(pthread_attr_setstacksize(&attributes, 512 * 1024) == 0);
    printf("Diff scratch arrays per recursive frame: %zu bytes\n", 34 * sizeof(choice_t));
    fflush(stdout);
    assert(pthread_create(&thread, &attributes, small_stack_diff, NULL) == 0);
    assert(pthread_join(thread, NULL) == 0);
    assert(pthread_attr_destroy(&attributes) == 0);
    puts("64-nibble trie diff passed on a 512 KiB thread stack");
    return 0;
}
