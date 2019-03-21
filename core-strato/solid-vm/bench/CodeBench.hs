{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
import Control.DeepSeq
import Criterion.Main
-- import Data.Binary
import Data.FileEmbed
import qualified Data.ByteString.Char8 as BC
-- import qualified Data.ByteString.Lazy as BL
import qualified Data.Map as M
import qualified Data.Text as T
import Text.Parsec (runParser, ParseError)

import Blockchain.Strato.Model.SHA
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import CodeCollection

instance NFData ParseError where
  rnf = rwhnf

{-# NOINLINE wingsContract #-}
wingsContract :: String
wingsContract = BC.unpack $(embedFile "bench/wings.sol")

wingsCC :: CodeCollection
wingsCC =
  let file = either (error . show) id $ runParser solidityFile "" ""  wingsContract
      namedContracts = [(T.unpack name, xabiToContract (T.unpack name) (map T.unpack parents') xabi)
                        | NamedXabi name (xabi, parents') <- unsourceUnits file]
  in applyInheritance . CodeCollection $ M.fromList namedContracts

strBench :: Benchmark
strBench = bench "time to take the length of the wings contract"
         $ nf length wingsContract

strHashBench :: Benchmark
strHashBench = bench "time spent on hashing the wings contract"
             $ nf hash (BC.pack wingsContract)

parseBench :: Benchmark
parseBench = bench "time required to parse the contract"
           $ nf (runParser solidityFile "" "") wingsContract

showCCBench :: Benchmark
showCCBench = bench "time to show the wingsCC"
            $ nf (BC.pack . show) wingsCC

hashCCBench :: Benchmark
hashCCBench = bench "time to hash the wingsCC"
            $ nf hash (BC.pack $ show wingsCC)

readCC :: BC.ByteString -> CodeCollection
readCC = read . BC.unpack

readCCBench :: Benchmark
readCCBench = bench "time to read the wingsCC"
            $ nf readCC (BC.pack $ show wingsCC)

-- encodeCCBench :: Benchmark
-- encodeCCBench = bench "time to Data.Binary.encode wingsCC"
--               $ nf encode wingsCC

-- decodeCC :: BL.ByteString -> CodeCollection
-- decodeCC = decode

-- decodeCCBench :: Benchmark
-- decodeCCBench = bench "time to Data.Binary.decode wingsCC"
--               $ nf decodeCC (encode wingsCC)
main :: IO ()
main = defaultMain [strHashBench, parseBench, strBench, showCCBench, hashCCBench, readCCBench]
