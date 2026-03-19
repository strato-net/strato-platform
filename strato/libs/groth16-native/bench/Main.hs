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
    let (pkPath, witnessPath) = case args of
            (pk:w:_) -> (pk, w)
            (w:_) -> ("circuits/01x02/circuit_pk.json", w)
            [] -> ("circuits/01x02/circuit_pk.json", "/tmp/witness.wtns")
    
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
                    proof@(Proof !_piA !_piB !_piC) <- prove pk witness
                    t5 <- getCurrentTime
                    let proveTime = realToFrac (diffUTCTime t5 t4) :: Double
                    putStrLn "  Proof generated!"
                    
                    -- Print proof coordinates for debugging
                    let ((ax, ay), ((bx0, bx1), (by0, by1)), (cx, cy)) = proofToIntegers proof
                    putStrLn "\n=== PROOF COORDINATES ==="
                    putStrLn $ "A.x: " ++ show ax
                    putStrLn $ "A.y: " ++ show ay
                    putStrLn $ "B.x: [" ++ show bx0 ++ ", " ++ show bx1 ++ "]"
                    putStrLn $ "B.y: [" ++ show by0 ++ ", " ++ show by1 ++ "]"
                    putStrLn $ "C.x: " ++ show cx
                    putStrLn $ "C.y: " ++ show cy
                    
                    printf "\n=== RESULTS ===\n"
                    printf "PK load time:     %.2f seconds\n" loadTime
                    printf "Witness load:     %.3f seconds\n" witnessTime
                    printf "Proof generation: %.2f seconds\n" proveTime
                    printf "Total time:       %.2f seconds\n" (loadTime + witnessTime + proveTime)
