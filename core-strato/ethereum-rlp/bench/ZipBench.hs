-- Realistic RLP inputs collected from 100 Wings tickets on SolidVM
-- The input file consists of lines of hex encoded RLP separated
-- by newlines, gzipped.
import Codec.Compression.GZip
import Criterion.Main
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Base16 as B16

import Blockchain.Data.RLP

main :: IO ()
main = do
  input <- BL.toStrict . decompress <$> BL.readFile "./bench/vm_100_txs.gz"
  let rlps = map (rlpDeserialize . fst . B16.decode)
           . filter (not . C8.null)
           $ C8.split '\n' input
  defaultMain [ bench "bytestring based rlp" $ nf (map rlpSerialize_safe) rlps
              , bench "reverse post order traversal rlp" $ nf (map rlpSerialize) rlps
              , bench "getting buffer length" $ nf (map finalLength) rlps
              , bench "input list length" $ nf length rlps
              ]
