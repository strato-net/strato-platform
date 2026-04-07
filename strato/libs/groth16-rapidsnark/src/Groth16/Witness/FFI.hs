{-# LANGUAGE ForeignFunctionInterface #-}
{-# LANGUAGE CApiFFI #-}

-- | FFI bindings to the native circom witness calculator (wasm3-based)
--
-- This provides direct access to witness calculation without Node.js/snarkjs.
--
module Groth16.Witness.FFI
  ( c_circom_calc_witness
  , c_circom_witness_size
  ) where

import Foreign.C.Types
import Foreign.C.String
import Foreign.Ptr

-- | Calculate witness from a circom WASM file and JSON inputs.
--
-- Parameters:
--   wasm_path    - Path to the circuit .wasm file
--   inputs_json  - JSON string with circuit inputs
--   witness_out  - Output buffer for witness
--   witness_size - In: buffer size; Out: actual size
--   error_out    - Output buffer for error message
--   error_size   - Size of error buffer
--
-- Returns 0 on success, non-zero on error.
--
foreign import capi safe "circom_witness.h circom_calc_witness"
  c_circom_calc_witness 
    :: CString      -- ^ wasm_path
    -> CString      -- ^ inputs_json
    -> Ptr CUChar   -- ^ witness_out
    -> Ptr CSize    -- ^ witness_size (in/out)
    -> CString      -- ^ error_out
    -> CSize        -- ^ error_size
    -> IO CInt

-- | Get the required witness buffer size for a circuit.
--
-- Parameters:
--   wasm_path    - Path to the circuit .wasm file
--   size_out     - Output: required buffer size
--   error_out    - Output buffer for error message
--   error_size   - Size of error buffer
--
-- Returns 0 on success, non-zero on error.
--
foreign import capi safe "circom_witness.h circom_witness_size"
  c_circom_witness_size
    :: CString      -- ^ wasm_path
    -> Ptr CSize    -- ^ size_out
    -> CString      -- ^ error_out
    -> CSize        -- ^ error_size
    -> IO CInt
