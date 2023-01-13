{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Mining.Options where

import           Blockchain.Mining
import           HFlags

defineEQFlag "aMiner" [| Instant :: MinerType |] "MINER" "What mining algorithm"

-- For integral types you have to explicitly define Int or Integer.
defineFlag "threads" (1 :: Int) "Number of mining threads"

defineFlag "blocktime" (10000 :: Int) "Blocktime in milliseconds for Normal miner"
defineFlag "variance" (1000 :: Int) "Blocktime variance in milliseconds for Normal miner"
defineFlag "minQuorumSize" (1 :: Int) "Minimum quorum size for mining"
defineFlag "useSyncMode" False "Whether or not to wait for P2P to meet minQuorumSize before mining blocks"
defineFlag "pgPoolSize" (5 :: Int) "Size of postgres pool"

-- -- You can also do simple range checks with this.
-- defineCustomFlag "coinbase" [| 57 :: Integer |] "ADDRESS"
--   [| \s -> let (p,q) = head $ ((readHex s) :: [(Integer, String)])
--            in if (length s <= 40) && (length q < 1)
--               then p
--               else error "The address should be a valid hexadecimal number, no more than 40 characters"
--    |]
--   [| show |]
--   "Coinbase address"
