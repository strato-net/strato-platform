/*
 * circom_witness.h - Circom witness calculator using wasm3
 * 
 * This implements the circom WASM runtime protocol to calculate
 * witnesses natively without Node.js/snarkjs.
 * 
 * License: MIT (same as wasm3)
 */

#ifndef CIRCOM_WITNESS_H
#define CIRCOM_WITNESS_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Calculate witness from a circom WASM file and JSON inputs.
 * 
 * Parameters:
 *   wasm_path    - Path to the circuit .wasm file
 *   inputs_json  - JSON string with circuit inputs (e.g., '{"a": "3", "b": "11"}')
 *   witness_out  - Output buffer for witness (.wtns binary format)
 *   witness_size - In: size of witness_out buffer; Out: actual witness size
 *   error_out    - Output buffer for error message (if any)
 *   error_size   - Size of error_out buffer
 * 
 * Returns:
 *   0 on success, non-zero on error
 * 
 * The output is in standard .wtns binary format, compatible with
 * snarkjs and rapidsnark.
 */
int circom_calc_witness(
    const char* wasm_path,
    const char* inputs_json,
    uint8_t* witness_out,
    size_t* witness_size,
    char* error_out,
    size_t error_size
);

/*
 * Get the required witness buffer size for a circuit.
 * 
 * Parameters:
 *   wasm_path    - Path to the circuit .wasm file
 *   size_out     - Output: required buffer size in bytes
 *   error_out    - Output buffer for error message (if any)
 *   error_size   - Size of error_out buffer
 * 
 * Returns:
 *   0 on success, non-zero on error
 */
int circom_witness_size(
    const char* wasm_path,
    size_t* size_out,
    char* error_out,
    size_t error_size
);

#ifdef __cplusplus
}
#endif

#endif /* CIRCOM_WITNESS_H */
