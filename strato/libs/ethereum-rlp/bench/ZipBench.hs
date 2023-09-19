-- Realistic RLP inputs collected from 100 Wings tickets on SolidVM
-- The input file consists of lines of hex encoded RLP separated
-- by newlines, gzipped.

import Blockchain.Data.RLP
import Codec.Compression.GZip
import Criterion.Main
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import Data.Either (fromRight)

main :: IO ()
main = do
  input <- BL.toStrict . decompress <$> BL.readFile "./bench/vm_100_txs.gz"
  let rlps =
        map (rlpDeserialize . fromRight (C8.pack "A") . B16.decode)
          . filter (not . C8.null)
          $ C8.split '\n' input
  defaultMain
    [ bench "bytestring based rlp" $ nf (map rlpSerialize) rlps,
      bench "length " $ nf length rlps
    ]
