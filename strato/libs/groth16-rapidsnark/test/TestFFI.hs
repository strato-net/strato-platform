-- Simple test to verify rapidsnark FFI is linked and callable
module Main where

import Foreign.Marshal.Alloc (alloca)
import Foreign.Storable (peek)
import Foreign.C.Types (CULLong)

import Groth16.Prover.FFI (c_groth16_proof_size)

main :: IO ()
main = do
  putStrLn "Testing rapidsnark FFI..."
  
  -- Call groth16_proof_size - should return 810
  proofSize <- alloca $ \ptr -> do
    c_groth16_proof_size ptr
    peek ptr
  
  putStrLn $ "groth16_proof_size returned: " ++ show (proofSize :: CULLong)
  
  if proofSize == 810
    then putStrLn "SUCCESS: FFI is working correctly!"
    else putStrLn $ "UNEXPECTED: Expected 810, got " ++ show proofSize
