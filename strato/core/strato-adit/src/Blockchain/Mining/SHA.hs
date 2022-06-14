{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Mining.SHA (shaMiner, findNonce, shaify) where

import qualified Crypto.Hash.SHA256       as SHA256
import qualified Data.ByteString          as BS
import           Data.Time.Clock.POSIX
import           Debug.Trace
import           System.Random

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Util

import           Blockchain.Mining

shaMiner :: Miner
shaMiner = Miner mineSHA verifySHA

findNonce :: Integer -> Integer
findNonce d = head $ takeWhile (> d) . fmap (\x -> byteString2Integer $ shaify (rlpEncode x)) $ ([1..] :: [Integer])

invDiff :: Integer -> Integer
invDiff d = round diff' :: Integer
   where diff' = (2^(256::Integer)) / (fromIntegral d) :: Double
-- invDiff d = quot (2^(256::Integer)) d

-- mine = foldl (&&) (repeat verify) -- (if verify could live in a monad keeping state..)
mineSHA :: Block -> IO (Maybe Integer)
mineSHA b@Block{blockBlockData=bd} = do

    let difficulty = blockDataDifficulty bd

    let diff = invDiff difficulty
    offset <- randomRIO (0 :: Integer, 4503599627370495 :: Integer)
    let nn = (byteString2Integer $ headerHash b offset) <= diff

    case nn of
      False -> return $ Nothing
      True  -> return $ Just offset

verifySHA :: Block -> Bool
verifySHA b = trace ("n: " ++ (show n) ++ "\nnonce: " ++ (show nonce) ++ "\n(2^256/diff): " ++ (show diff) ++ "\n(diff): " ++ (show diff')) n <= diff
  where
        n     = byteString2Integer $ headerHash b nonce
        bd    = blockBlockData b
        nonce = toInteger $ blockDataNonce bd
        diff  = invDiff $ diff'
        diff' = blockDataDifficulty bd

blockData2RLP :: BlockData -> Integer -> RLPObject
blockData2RLP bd n =
  RLPArray [
      rlpEncode $ blockDataParentHash bd,
      rlpEncode $ blockDataUnclesHash bd,
      rlpEncode $ blockDataCoinbase bd,
      rlpEncode $ blockDataStateRoot bd,
      rlpEncode $ blockDataTransactionsRoot bd,
      rlpEncode $ blockDataReceiptsRoot bd,
      rlpEncode $ blockDataLogBloom bd,
      rlpEncode $ blockDataDifficulty bd,
      rlpEncode $ blockDataNumber bd,
      rlpEncode $ blockDataGasLimit bd,
      rlpEncode $ blockDataGasUsed bd,
      rlpEncode (round $ utcTimeToPOSIXSeconds $ blockDataTimestamp bd::Integer),
      rlpEncode $ blockDataExtraData bd,
      rlpEncode $ n
      ]

shaify :: RLPObject -> BS.ByteString
shaify x = SHA256.hash $ SHA256.hash $ rlpSerialize x

headerHash :: Block -> Integer -> BS.ByteString
headerHash b n = shaify $ blockData2RLP (blockBlockData b) n
