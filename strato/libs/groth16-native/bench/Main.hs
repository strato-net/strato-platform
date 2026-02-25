{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE BangPatterns #-}

-- | Benchmark for the native Groth16 prover
-- 
-- Usage: bench-native-prover [witness.wtns]
--
-- This loads a witness file and the proving key, then times
-- the native Haskell Groth16 proof generation.

module Main where

import Data.Time.Clock
import System.Environment (getArgs)
import Text.Printf
import qualified Data.Text as T

import Groth16.BN254

main :: IO ()
main = do
    args <- getArgs
    let witnessPath = case args of
            (x:_) -> x
            [] -> "/tmp/witness.wtns"
    let pkPath = "circuits/01x02/circuit_pk.json"
    
    putStrLn "=== Native Groth16 Prover Benchmark ==="
    putStrLn $ "Witness: " ++ witnessPath
    putStrLn $ "Proving key: " ++ pkPath
    putStrLn ""
    
    -- Load proving key
    putStrLn "Loading proving key..."
    t0 <- getCurrentTime
    pkResult <- loadProvingKeyJSON pkPath
    case pkResult of
        Left err -> error $ "Failed to parse proving key: " ++ T.unpack err
        Right pk -> do
            t1 <- getCurrentTime
            let loadTime = realToFrac (diffUTCTime t1 t0) :: Double
            printf "  Proving key loaded in %.2f seconds\n" loadTime
            printf "  nVars=%d, nPublic=%d, domainSize=%d\n" (pkNVars pk) (pkNPublic pk) (pkDomainSize pk)
            printf "  pkA: %d points, pkH: %d points\n" (length (pkA pk)) (length (pkH pk))
            
            -- Load witness
            putStrLn "\nLoading witness..."
            t2 <- getCurrentTime
            witnessResult <- loadWitness witnessPath
            case witnessResult of
                Left err -> error $ "Failed to load witness: " ++ T.unpack err
                Right witness -> do
                    t3 <- getCurrentTime
                    let witnessTime = realToFrac (diffUTCTime t3 t2) :: Double
                    printf "  Witness loaded in %.3f seconds\n" witnessTime
            
                    -- Generate proof
                    putStrLn "\nGenerating proof with native prover..."
                    putStrLn "(This may take a while...)"
                    t4 <- getCurrentTime
                    (Proof !_piA !_piB !_piC) <- prove pk witness
                    t5 <- getCurrentTime
                    let proveTime = realToFrac (diffUTCTime t5 t4) :: Double
                    putStrLn "  Proof generated!"
                    printf "\n=== RESULTS ===\n"
                    printf "PK load time:     %.2f seconds\n" loadTime
                    printf "Witness load:     %.3f seconds\n" witnessTime
                    printf "Proof generation: %.2f seconds\n" proveTime
                    printf "Total time:       %.2f seconds\n" (loadTime + witnessTime + proveTime)
