/*
 * circom_witness.c - Circom witness calculator using wasm3
 * 
 * Implements the circom WASM runtime protocol for witness calculation.
 * Outputs .wtns binary format compatible with snarkjs/rapidsnark.
 */

#include "circom_witness.h"
#include "wasm3/wasm3.h"
#include "wasm3/m3_env.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

/* .wtns file format constants */
#define WTNS_MAGIC "wtns"
#define WTNS_VERSION 2
#define WTNS_SECTION_HEADER 1
#define WTNS_SECTION_WITNESS 2

/* --------------------------------------------------------------------------
 * FNV-1a hash (same as snarkjs/circom uses for signal names)
 * -------------------------------------------------------------------------- */

static void fnv_hash(const char* str, uint32_t* msb, uint32_t* lsb) {
    uint64_t h = 0xcbf29ce484222325ULL;  /* FNV offset basis */
    const uint64_t prime = 0x100000001b3ULL;  /* FNV prime */
    
    while (*str) {
        h ^= (uint64_t)(unsigned char)*str++;
        h *= prime;
    }
    
    *msb = (uint32_t)(h >> 32);
    *lsb = (uint32_t)(h & 0xFFFFFFFF);
}

/* --------------------------------------------------------------------------
 * Simple JSON parser for circom inputs
 * Supports: strings, numbers, arrays of strings/numbers
 * -------------------------------------------------------------------------- */

typedef struct {
    char* key;
    char** values;      /* Array of string values (decimal numbers) */
    size_t value_count;
} JsonEntry;

typedef struct {
    JsonEntry* entries;
    size_t count;
} JsonInputs;

static void skip_whitespace(const char** p) {
    while (**p && isspace(**p)) (*p)++;
}

static char* parse_string(const char** p) {
    skip_whitespace(p);
    if (**p != '"') return NULL;
    (*p)++;
    
    const char* start = *p;
    while (**p && **p != '"') (*p)++;
    
    size_t len = *p - start;
    char* str = malloc(len + 1);
    memcpy(str, start, len);
    str[len] = '\0';
    
    if (**p == '"') (*p)++;
    return str;
}

static char* parse_number(const char** p) {
    skip_whitespace(p);
    const char* start = *p;
    
    if (**p == '-') (*p)++;
    while (**p && (isdigit(**p) || **p == '.' || **p == 'e' || **p == 'E' || **p == '+' || **p == '-')) {
        (*p)++;
    }
    
    size_t len = *p - start;
    if (len == 0) return NULL;
    
    char* str = malloc(len + 1);
    memcpy(str, start, len);
    str[len] = '\0';
    return str;
}

static char* parse_value(const char** p) {
    skip_whitespace(p);
    if (**p == '"') {
        return parse_string(p);
    } else if (**p == '-' || isdigit(**p)) {
        return parse_number(p);
    }
    return NULL;
}

static JsonInputs* parse_json_inputs(const char* json) {
    JsonInputs* inputs = calloc(1, sizeof(JsonInputs));
    inputs->entries = calloc(256, sizeof(JsonEntry));  /* Max 256 inputs */
    
    const char* p = json;
    skip_whitespace(&p);
    
    if (*p != '{') {
        free(inputs->entries);
        free(inputs);
        return NULL;
    }
    p++;
    
    while (*p) {
        skip_whitespace(&p);
        if (*p == '}') break;
        if (*p == ',') { p++; continue; }
        
        /* Parse key */
        char* key = parse_string(&p);
        if (!key) break;
        
        skip_whitespace(&p);
        if (*p != ':') { free(key); break; }
        p++;
        
        skip_whitespace(&p);
        
        JsonEntry* entry = &inputs->entries[inputs->count++];
        entry->key = key;
        entry->values = calloc(1024, sizeof(char*));  /* Max 1024 array elements */
        entry->value_count = 0;
        
        if (*p == '[') {
            /* Array of values */
            p++;
            while (*p) {
                skip_whitespace(&p);
                if (*p == ']') { p++; break; }
                if (*p == ',') { p++; continue; }
                
                char* val = parse_value(&p);
                if (val) {
                    entry->values[entry->value_count++] = val;
                }
            }
        } else {
            /* Single value */
            char* val = parse_value(&p);
            if (val) {
                entry->values[entry->value_count++] = val;
            }
        }
    }
    
    return inputs;
}

static void free_json_inputs(JsonInputs* inputs) {
    if (!inputs) return;
    for (size_t i = 0; i < inputs->count; i++) {
        free(inputs->entries[i].key);
        for (size_t j = 0; j < inputs->entries[i].value_count; j++) {
            free(inputs->entries[i].values[j]);
        }
        free(inputs->entries[i].values);
    }
    free(inputs->entries);
    free(inputs);
}

/* --------------------------------------------------------------------------
 * BigInt handling (decimal string to 32-bit limbs)
 * -------------------------------------------------------------------------- */

/* 
 * Convert decimal string to array of 32-bit limbs (little-endian).
 * Returns number of limbs written.
 */
static int decimal_to_limbs(const char* decimal, uint32_t* limbs, int max_limbs) {
    /* Simple implementation: multiply-and-add in base 2^32 */
    memset(limbs, 0, max_limbs * sizeof(uint32_t));
    
    const char* p = decimal;
    int negative = 0;
    if (*p == '-') {
        negative = 1;
        p++;
    }
    
    while (*p) {
        if (!isdigit(*p)) break;
        
        /* Multiply by 10 */
        uint64_t carry = 0;
        for (int i = 0; i < max_limbs; i++) {
            uint64_t tmp = (uint64_t)limbs[i] * 10 + carry;
            limbs[i] = (uint32_t)(tmp & 0xFFFFFFFF);
            carry = tmp >> 32;
        }
        
        /* Add digit */
        carry = (*p - '0');
        for (int i = 0; i < max_limbs && carry; i++) {
            uint64_t tmp = (uint64_t)limbs[i] + carry;
            limbs[i] = (uint32_t)(tmp & 0xFFFFFFFF);
            carry = tmp >> 32;
        }
        
        p++;
    }
    
    /* For negative numbers in field arithmetic, we'd need to compute p - |x| */
    /* For now, we assume all inputs are non-negative (typical for circom) */
    (void)negative;
    
    return max_limbs;
}

/* --------------------------------------------------------------------------
 * WASM host function callbacks (circom runtime imports)
 * -------------------------------------------------------------------------- */

/* Most of these are no-ops for logging */

static m3ApiRawFunction(m3_error) {
    m3ApiGetArg(int32_t, code)
    m3ApiGetArg(int32_t, msgPtr)
    m3ApiGetArg(int32_t, msgLen)
    m3ApiGetArg(int32_t, a)
    m3ApiGetArg(int32_t, b)
    m3ApiGetArg(int32_t, c)
    
    (void)code; (void)msgPtr; (void)msgLen; (void)a; (void)b; (void)c;
    /* Could extract error message from memory here */
    m3ApiTrap("circom runtime error");
}

static m3ApiRawFunction(m3_log_signal) {
    m3ApiGetArg(int32_t, a)
    m3ApiGetArg(int32_t, b)
    (void)a; (void)b;
    m3ApiSuccess();
}

static m3ApiRawFunction(m3_log_component) {
    m3ApiGetArg(int32_t, a)
    (void)a;
    m3ApiSuccess();
}

static m3ApiRawFunction(m3_exception_handler) {
    m3ApiGetArg(int32_t, code)
    (void)code;
    m3ApiSuccess();
}

static m3ApiRawFunction(m3_show_memory) {
    m3ApiSuccess();
}

static m3ApiRawFunction(m3_print_error_message) {
    m3ApiSuccess();
}

static m3ApiRawFunction(m3_write_buffer_message) {
    m3ApiSuccess();
}

/* --------------------------------------------------------------------------
 * Main witness calculation
 * -------------------------------------------------------------------------- */

typedef struct {
    IM3Runtime runtime;
    IM3Module module;
    IM3Function fn_getFieldNumLen32;
    IM3Function fn_getRawPrime;
    IM3Function fn_readSharedRWMemory;
    IM3Function fn_writeSharedRWMemory;
    IM3Function fn_setInputSignal;
    IM3Function fn_getWitness;
    IM3Function fn_getWitnessSize;
    IM3Function fn_init;
    uint32_t n32;  /* Number of 32-bit limbs per field element */
} CircomWasm;

static int setup_circom_runtime(CircomWasm* cw, IM3Environment env, 
                                 const uint8_t* wasm_bytes, size_t wasm_size,
                                 char* error_out, size_t error_size) {
    M3Result result;
    
    /* Parse module */
    result = m3_ParseModule(env, &cw->module, wasm_bytes, wasm_size);
    if (result) {
        snprintf(error_out, error_size, "Parse error: %s", result);
        return -1;
    }
    
    /* Create runtime with enough stack and memory */
    cw->runtime = m3_NewRuntime(env, 64 * 1024, NULL);  /* 64KB stack */
    if (!cw->runtime) {
        snprintf(error_out, error_size, "Failed to create runtime");
        return -1;
    }
    
    /* Load module */
    result = m3_LoadModule(cw->runtime, cw->module);
    if (result) {
        snprintf(error_out, error_size, "Load error: %s", result);
        return -1;
    }
    
    /* Link host functions */
    m3_LinkRawFunction(cw->module, "runtime", "error", "v(iiiiii)", m3_error);
    m3_LinkRawFunction(cw->module, "runtime", "logSetSignal", "v(ii)", m3_log_signal);
    m3_LinkRawFunction(cw->module, "runtime", "logGetSignal", "v(ii)", m3_log_signal);
    m3_LinkRawFunction(cw->module, "runtime", "logFinishComponent", "v(i)", m3_log_component);
    m3_LinkRawFunction(cw->module, "runtime", "logStartComponent", "v(i)", m3_log_component);
    m3_LinkRawFunction(cw->module, "runtime", "log", "v(i)", m3_log_component);
    m3_LinkRawFunction(cw->module, "runtime", "exceptionHandler", "v(i)", m3_exception_handler);
    m3_LinkRawFunction(cw->module, "runtime", "showSharedRWMemory", "v()", m3_show_memory);
    m3_LinkRawFunction(cw->module, "runtime", "printErrorMessage", "v()", m3_print_error_message);
    m3_LinkRawFunction(cw->module, "runtime", "writeBufferMessage", "v()", m3_write_buffer_message);
    
    /* Find exported functions */
    result = m3_FindFunction(&cw->fn_getFieldNumLen32, cw->runtime, "getFieldNumLen32");
    if (result) {
        snprintf(error_out, error_size, "Function getFieldNumLen32 not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_getRawPrime, cw->runtime, "getRawPrime");
    if (result) {
        snprintf(error_out, error_size, "Function getRawPrime not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_readSharedRWMemory, cw->runtime, "readSharedRWMemory");
    if (result) {
        snprintf(error_out, error_size, "Function readSharedRWMemory not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_writeSharedRWMemory, cw->runtime, "writeSharedRWMemory");
    if (result) {
        snprintf(error_out, error_size, "Function writeSharedRWMemory not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_setInputSignal, cw->runtime, "setInputSignal");
    if (result) {
        snprintf(error_out, error_size, "Function setInputSignal not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_getWitness, cw->runtime, "getWitness");
    if (result) {
        snprintf(error_out, error_size, "Function getWitness not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_getWitnessSize, cw->runtime, "getWitnessSize");
    if (result) {
        snprintf(error_out, error_size, "Function getWitnessSize not found: %s", result);
        return -1;
    }
    
    result = m3_FindFunction(&cw->fn_init, cw->runtime, "init");
    if (result) {
        snprintf(error_out, error_size, "Function init not found: %s", result);
        return -1;
    }
    
    return 0;
}

static int call_getFieldNumLen32(CircomWasm* cw, uint32_t* out) {
    M3Result result = m3_Call(cw->fn_getFieldNumLen32, 0, NULL);
    if (result) return -1;
    
    result = m3_GetResultsV(cw->fn_getFieldNumLen32, out);
    return result ? -1 : 0;
}

static int call_getRawPrime(CircomWasm* cw) {
    M3Result result = m3_Call(cw->fn_getRawPrime, 0, NULL);
    return result ? -1 : 0;
}

static int call_readSharedRWMemory(CircomWasm* cw, uint32_t idx, uint32_t* out) {
    M3Result result = m3_CallV(cw->fn_readSharedRWMemory, idx);
    if (result) return -1;
    
    result = m3_GetResultsV(cw->fn_readSharedRWMemory, out);
    return result ? -1 : 0;
}

static int call_writeSharedRWMemory(CircomWasm* cw, uint32_t idx, uint32_t val) {
    M3Result result = m3_CallV(cw->fn_writeSharedRWMemory, idx, val);
    return result ? -1 : 0;
}

static int call_setInputSignal(CircomWasm* cw, uint32_t hmsb, uint32_t hlsb, uint32_t pos) {
    M3Result result = m3_CallV(cw->fn_setInputSignal, hmsb, hlsb, pos);
    return result ? -1 : 0;
}

static int call_getWitness(CircomWasm* cw, uint32_t idx) {
    M3Result result = m3_CallV(cw->fn_getWitness, idx);
    return result ? -1 : 0;
}

static int call_getWitnessSize(CircomWasm* cw, uint32_t* out) {
    M3Result result = m3_Call(cw->fn_getWitnessSize, 0, NULL);
    if (result) return -1;
    
    result = m3_GetResultsV(cw->fn_getWitnessSize, out);
    return result ? -1 : 0;
}

static int call_init(CircomWasm* cw, int sanity_check) {
    M3Result result = m3_CallV(cw->fn_init, sanity_check);
    return result ? -1 : 0;
}

static uint8_t* read_file(const char* path, size_t* size_out) {
    FILE* f = fopen(path, "rb");
    if (!f) return NULL;
    
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    
    uint8_t* data = malloc(size);
    if (!data) {
        fclose(f);
        return NULL;
    }
    
    size_t read = fread(data, 1, size, f);
    fclose(f);
    
    if (read != (size_t)size) {
        free(data);
        return NULL;
    }
    
    *size_out = size;
    return data;
}

int circom_calc_witness(
    const char* wasm_path,
    const char* inputs_json,
    uint8_t* witness_out,
    size_t* witness_size,
    char* error_out,
    size_t error_size
) {
    int ret = -1;
    uint8_t* wasm_bytes = NULL;
    JsonInputs* inputs = NULL;
    IM3Environment env = NULL;
    CircomWasm cw = {0};
    uint32_t* limbs = NULL;
    uint8_t* prime_bytes = NULL;
    
    /* Read WASM file */
    size_t wasm_size;
    wasm_bytes = read_file(wasm_path, &wasm_size);
    if (!wasm_bytes) {
        snprintf(error_out, error_size, "Failed to read WASM file: %s", wasm_path);
        goto cleanup;
    }
    
    /* Parse JSON inputs */
    inputs = parse_json_inputs(inputs_json);
    if (!inputs) {
        snprintf(error_out, error_size, "Failed to parse JSON inputs");
        goto cleanup;
    }
    
    /* Create wasm3 environment */
    env = m3_NewEnvironment();
    if (!env) {
        snprintf(error_out, error_size, "Failed to create wasm3 environment");
        goto cleanup;
    }
    
    /* Setup circom runtime */
    if (setup_circom_runtime(&cw, env, wasm_bytes, wasm_size, error_out, error_size) != 0) {
        goto cleanup;
    }
    
    /* Get field size (number of 32-bit limbs) */
    if (call_getFieldNumLen32(&cw, &cw.n32) != 0) {
        snprintf(error_out, error_size, "Failed to get field size");
        goto cleanup;
    }
    
    /* Allocate limbs buffer */
    limbs = calloc(cw.n32, sizeof(uint32_t));
    if (!limbs) {
        snprintf(error_out, error_size, "Memory allocation failed");
        goto cleanup;
    }
    
    /* Get the prime from the circuit */
    prime_bytes = calloc(cw.n32 * 4, 1);
    if (!prime_bytes) {
        snprintf(error_out, error_size, "Memory allocation failed");
        goto cleanup;
    }
    
    if (call_getRawPrime(&cw) != 0) {
        snprintf(error_out, error_size, "Failed to get raw prime");
        goto cleanup;
    }
    
    /* Read prime from shared memory 
     * In circom WASM: word 0 = LSB, word n32-1 = MSB
     * .wtns format: little-endian bytes (LSB at byte 0)
     */
    for (uint32_t k = 0; k < cw.n32; k++) {
        uint32_t val;
        if (call_readSharedRWMemory(&cw, k, &val) != 0) {
            snprintf(error_out, error_size, "Failed to read prime from shared memory");
            goto cleanup;
        }
        /* Word k goes to bytes k*4 through k*4+3 (little-endian) */
        uint32_t idx = k * 4;
        prime_bytes[idx + 0] = (val) & 0xFF;
        prime_bytes[idx + 1] = (val >> 8) & 0xFF;
        prime_bytes[idx + 2] = (val >> 16) & 0xFF;
        prime_bytes[idx + 3] = (val >> 24) & 0xFF;
    }
    
    /* Initialize circuit */
    if (call_init(&cw, 0) != 0) {
        snprintf(error_out, error_size, "Failed to initialize circuit");
        goto cleanup;
    }
    
    /* Set input signals */
    for (size_t i = 0; i < inputs->count; i++) {
        JsonEntry* entry = &inputs->entries[i];
        
        /* Compute FNV hash of signal name */
        uint32_t hmsb, hlsb;
        fnv_hash(entry->key, &hmsb, &hlsb);
        
        /* Set each value in the array */
        for (size_t j = 0; j < entry->value_count; j++) {
            /* Convert decimal string to limbs (little-endian: limbs[0] = LSB) */
            decimal_to_limbs(entry->values[j], limbs, cw.n32);
            
            /* Write to shared memory
             * circom expects: word 0 = LSB, word n32-1 = MSB
             * Our limbs array: limbs[0] = LSB, limbs[n32-1] = MSB
             * So write directly without reversal
             */
            for (uint32_t k = 0; k < cw.n32; k++) {
                if (call_writeSharedRWMemory(&cw, k, limbs[k]) != 0) {
                    snprintf(error_out, error_size, "Failed to write shared memory");
                    goto cleanup;
                }
            }
            
            /* Set the input signal */
            if (call_setInputSignal(&cw, hmsb, hlsb, (uint32_t)j) != 0) {
                snprintf(error_out, error_size, "Failed to set input signal '%s'", entry->key);
                goto cleanup;
            }
        }
    }
    
    /* Get witness size */
    uint32_t wit_count;
    if (call_getWitnessSize(&cw, &wit_count) != 0) {
        snprintf(error_out, error_size, "Failed to get witness size");
        goto cleanup;
    }
    
    /* Calculate required output size for .wtns format:
     * - 4 bytes magic "wtns"
     * - 4 bytes version
     * - 4 bytes num sections
     * Section 1 (header):
     *   - 4 bytes section type
     *   - 8 bytes section size
     *   - 4 bytes n8 (field size in bytes, = 32 for BN254)
     *   - 32 bytes prime
     *   - 4 bytes witness count
     * Section 2 (witness):
     *   - 4 bytes section type
     *   - 8 bytes section size
     *   - wit_count * 32 bytes field elements
     */
    uint32_t n8 = 32;  /* Field element size in bytes (BN254 uses 32 bytes) */
    size_t header_section_size = 4 + n8 + 4;  /* n8_field + prime + witness_count */
    size_t witness_section_size = (size_t)wit_count * n8;
    size_t required_size = 4 + 4 + 4 +                           /* magic, version, num_sections */
                           4 + 8 + header_section_size +          /* header section */
                           4 + 8 + witness_section_size;          /* witness section */
    
    if (*witness_size < required_size) {
        snprintf(error_out, error_size, "Witness buffer too small: need %zu, have %zu", 
                 required_size, *witness_size);
        *witness_size = required_size;
        goto cleanup;
    }
    
    uint8_t* p = witness_out;
    
    /* Write file header */
    memcpy(p, WTNS_MAGIC, 4); p += 4;           /* magic "wtns" */
    *p++ = WTNS_VERSION; *p++ = 0; *p++ = 0; *p++ = 0;  /* version (little-endian u32) */
    *p++ = 2; *p++ = 0; *p++ = 0; *p++ = 0;     /* num_sections = 2 */
    
    /* Section 1: Header */
    *p++ = WTNS_SECTION_HEADER; *p++ = 0; *p++ = 0; *p++ = 0;  /* section type */
    /* section size (little-endian u64) */
    uint64_t sec1_size = header_section_size;
    for (int i = 0; i < 8; i++) { *p++ = (sec1_size >> (i*8)) & 0xFF; }
    /* n8 (field size in bytes = 32 for BN254) */
    *p++ = n8 & 0xFF; *p++ = (n8 >> 8) & 0xFF;
    *p++ = (n8 >> 16) & 0xFF; *p++ = (n8 >> 24) & 0xFF;
    /* prime (n8 bytes, little-endian - fetched from circuit) */
    memcpy(p, prime_bytes, n8); p += n8;
    /* witness count */
    *p++ = wit_count & 0xFF; *p++ = (wit_count >> 8) & 0xFF;
    *p++ = (wit_count >> 16) & 0xFF; *p++ = (wit_count >> 24) & 0xFF;
    
    /* Section 2: Witness data */
    *p++ = WTNS_SECTION_WITNESS; *p++ = 0; *p++ = 0; *p++ = 0;  /* section type */
    /* section size (little-endian u64) */
    uint64_t sec2_size = witness_section_size;
    for (int i = 0; i < 8; i++) { *p++ = (sec2_size >> (i*8)) & 0xFF; }
    
    /* Extract witness values */
    for (uint32_t i = 0; i < wit_count; i++) {
        /* Get witness value into shared memory */
        if (call_getWitness(&cw, i) != 0) {
            snprintf(error_out, error_size, "Failed to get witness %u", i);
            goto cleanup;
        }
        
        /* Read from shared memory and write directly as little-endian bytes
         * In circom WASM: word 0 = LSB, word n32-1 = MSB
         * .wtns format: little-endian bytes (LSB at byte 0)
         */
        for (uint32_t k = 0; k < cw.n32; k++) {
            uint32_t val;
            if (call_readSharedRWMemory(&cw, k, &val) != 0) {
                snprintf(error_out, error_size, "Failed to read shared memory");
                goto cleanup;
            }
            /* Word k goes directly to the next 4 bytes (little-endian) */
            *p++ = (val) & 0xFF;
            *p++ = (val >> 8) & 0xFF;
            *p++ = (val >> 16) & 0xFF;
            *p++ = (val >> 24) & 0xFF;
        }
    }
    
    *witness_size = required_size;
    ret = 0;
    
cleanup:
    if (prime_bytes) free(prime_bytes);
    if (limbs) free(limbs);
    if (cw.runtime) m3_FreeRuntime(cw.runtime);
    if (env) m3_FreeEnvironment(env);
    if (inputs) free_json_inputs(inputs);
    if (wasm_bytes) free(wasm_bytes);
    
    return ret;
}

int circom_witness_size(
    const char* wasm_path,
    size_t* size_out,
    char* error_out,
    size_t error_size
) {
    int ret = -1;
    uint8_t* wasm_bytes = NULL;
    IM3Environment env = NULL;
    CircomWasm cw = {0};
    
    /* Read WASM file */
    size_t wasm_size;
    wasm_bytes = read_file(wasm_path, &wasm_size);
    if (!wasm_bytes) {
        snprintf(error_out, error_size, "Failed to read WASM file: %s", wasm_path);
        goto cleanup;
    }
    
    /* Create wasm3 environment */
    env = m3_NewEnvironment();
    if (!env) {
        snprintf(error_out, error_size, "Failed to create wasm3 environment");
        goto cleanup;
    }
    
    /* Setup circom runtime */
    if (setup_circom_runtime(&cw, env, wasm_bytes, wasm_size, error_out, error_size) != 0) {
        goto cleanup;
    }
    
    /* Get field size */
    if (call_getFieldNumLen32(&cw, &cw.n32) != 0) {
        snprintf(error_out, error_size, "Failed to get field size");
        goto cleanup;
    }
    
    /* Initialize to get witness size */
    if (call_init(&cw, 0) != 0) {
        snprintf(error_out, error_size, "Failed to initialize circuit");
        goto cleanup;
    }
    
    /* Get witness count */
    uint32_t wit_count;
    if (call_getWitnessSize(&cw, &wit_count) != 0) {
        snprintf(error_out, error_size, "Failed to get witness size");
        goto cleanup;
    }
    
    /* Calculate total size for .wtns format (same as in circom_calc_witness) */
    uint32_t n8 = 32;  /* Field element size in bytes (BN254) */
    size_t header_section_size = 4 + n8 + 4;  /* n8_field + prime + witness_count */
    size_t witness_section_size = (size_t)wit_count * n8;
    *size_out = 4 + 4 + 4 +                           /* magic, version, num_sections */
                4 + 8 + header_section_size +          /* header section */
                4 + 8 + witness_section_size;          /* witness section */
    ret = 0;
    
cleanup:
    if (cw.runtime) m3_FreeRuntime(cw.runtime);
    if (env) m3_FreeEnvironment(env);
    if (wasm_bytes) free(wasm_bytes);
    
    return ret;
}
