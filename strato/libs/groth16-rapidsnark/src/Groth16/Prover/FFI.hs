{-# LANGUAGE ForeignFunctionInterface #-}
{-# LANGUAGE CApiFFI #-}

-- | Low-level FFI bindings to rapidsnark prover
--
-- This module provides direct bindings to the rapidsnark C API.
-- For a higher-level interface, use "Groth16.Prover".
--
module Groth16.Prover.FFI
  ( -- * Error codes
    proverOk
  , proverError
  , proverErrorShortBuffer
  , proverInvalidWitnessLength
    -- * Prover functions
  , c_groth16_prover_zkey_file
  , c_groth16_proof_size
    -- * Helper types
  , CProverResult
  ) where

import Foreign.C.Types
import Foreign.C.String
import Foreign.Ptr

-- | Result type from prover functions
type CProverResult = CInt

-- Error codes matching prover.h
proverOk :: CProverResult
proverOk = 0x0

proverError :: CProverResult
proverError = 0x1

proverErrorShortBuffer :: CProverResult
proverErrorShortBuffer = 0x2

proverInvalidWitnessLength :: CProverResult
proverInvalidWitnessLength = 0x3

-- | Get the size needed for proof output buffer
--
-- void groth16_proof_size(unsigned long long *proof_size);
foreign import capi safe "prover.h groth16_proof_size"
  c_groth16_proof_size :: Ptr CULLong -> IO ()

-- | Generate a Groth16 proof from a zkey file and witness buffer
--
-- int groth16_prover_zkey_file(
--     const char *zkey_file_path,
--     const void *wtns_buffer,
--     unsigned long long wtns_size,
--     char *proof_buffer,
--     unsigned long long *proof_size,
--     char *public_buffer,
--     unsigned long long *public_size,
--     char *error_msg,
--     unsigned long long error_msg_maxsize);
foreign import capi safe "prover.h groth16_prover_zkey_file"
  c_groth16_prover_zkey_file
    :: CString           -- ^ zkey_file_path
    -> Ptr ()            -- ^ wtns_buffer  
    -> CULLong           -- ^ wtns_size
    -> CString           -- ^ proof_buffer (output)
    -> Ptr CULLong       -- ^ proof_size (in/out)
    -> CString           -- ^ public_buffer (output)
    -> Ptr CULLong       -- ^ public_size (in/out)
    -> CString           -- ^ error_msg (output)
    -> CULLong           -- ^ error_msg_maxsize
    -> IO CProverResult
