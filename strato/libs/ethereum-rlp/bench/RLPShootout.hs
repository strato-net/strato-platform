{-# OPTIONS_GHC -fno-warn-unused-local-binds #-}
{-# OPTIONS_GHC -fno-warn-unused-matches #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

import Blockchain.Data.RLP
import Control.Monad
import Criterion.Main
import qualified Data.ByteString as BS
import qualified Data.ByteString.Random as BR
import Text.Printf

benchString :: (String, (RLPObject -> BS.ByteString)) -> BS.ByteString -> Benchmark
benchString (name, f) str =
  bench (printf "%s based string serialization; size=%d" name (BS.length str))
    . nf f
    $ RLPString str

benchOneLevel :: (String, (RLPObject -> BS.ByteString)) -> [BS.ByteString] -> Benchmark
benchOneLevel (name, f) arr =
  bench (printf "%s based one-level array serialization; size=1024x%d" name (BS.length (head arr)))
    . nf f
    . RLPArray
    . map RLPString
    $ arr

benchMP :: (String, RLPObject -> BS.ByteString) -> (Int, RLPObject) -> Benchmark
benchMP (name, f) (sz, obj) =
  bench (printf "%s based MP node simulation; value size=%d" name sz) $
    nf f obj

benchStacks :: (String, RLPObject -> BS.ByteString) -> (Int, Int, RLPObject) -> Benchmark
benchStacks (name, f) (ht, wid, obj) =
  bench (printf "%s based stack; height=%d, width=%d" name ht wid) $
    nf f obj

mpnode :: Int -> RLPObject
mpnode n = RLPArray . map RLPString $ (replicate 16 (BS.replicate 32 0xcc)) ++ [BS.replicate n 0x77]

stack :: Int -> Int -> RLPObject
stack k 0 = RLPString $ BS.replicate k 0x72
stack k n = RLPArray [stack k $ n - 1]

main :: IO ()
main = do
  strings <- mapM BR.random [16, 1024, 1024 * 1024, 10 * 1024 * 1024]
  arrays <- mapM (replicateM 1024 . BR.random) [1, 1024, 10 * 1024]
  let fullNodes = map (\x -> (x, mpnode x)) [0, 16, 256, 1024]
  let nstacks = map (\x -> (x, 4, stack 4 x)) [0, 4, 16, 64, 256, 1024]
  let wstacks = map (\x -> (x, 1024, stack 1024 x)) [0, 4, 16, 64, 256, 1024]

  let funcs = [("Bytestring", rlpSerialize)]
  defaultMain $
    concat
      [ liftM2 benchString funcs strings,
        liftM2 benchOneLevel funcs arrays,
        liftM2 benchMP funcs fullNodes,
        liftM2 benchStacks funcs nstacks,
        liftM2 benchStacks funcs wstacks
      ]
