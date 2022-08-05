{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
import Control.DeepSeq
import Criterion.Main
import Data.Binary
import Data.Either
import Data.ByteArray.Hash
import Data.FileEmbed
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import qualified Data.Map as M
import qualified Data.Text as T
import Text.Parsec (runParser, ParseError)

import Blockchain.Strato.Model.Keccak256
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import SolidVM.CodeCollectionTools
import SolidVM.Model.CodeCollection

instance NFData ParseError where
  rnf = rwhnf

instance NFData SipHash where
  rnf (SipHash sh) = rnf sh

{-# NOINLINE wingsContract #-}
wingsContract :: String
wingsContract = BC.unpack $(embedFile "bench/wings.sol")

wingsCC :: CodeCollection
wingsCC =
  let file = either (error . show) id $ runParser solidityFile "" "" wingsContract
      namedContracts = [(T.unpack name, fromRight (error "Didn't parse xabiToContract!") $ xabiToContract(T.unpack name) (map T.unpack parents') "" xabi)
                        | NamedXabi name (xabi, parents') <- unsourceUnits file]
      
  in fromRight (error "Didn't parse wingsCC!") . applyInheritance . CodeCollection $ M.fromList namedContracts

strBench :: Benchmark
strBench = bench "time to pack the wings contract"
         $ nf BC.pack wingsContract

strUnpackBench :: Benchmark
strUnpackBench = bench "time unpack the wings contrcat"
               $ nf BC.unpack (BC.pack wingsContract)

strHashBench :: Benchmark
strHashBench = bench "time spent on (keccak) hashing the wings contract"
             $ nf hash (BC.pack wingsContract)

strSipBench :: Benchmark
strSipBench = bench "time spent on (siphash) hashing the wings contract"
            $ nf (sipHash (SipKey 0x8888 0x1432)) (BC.pack wingsContract)

parseBench :: Benchmark
parseBench = bench "time required to parse the contract"
           $ nf (runParser solidityFile "" "") wingsContract

showCCBench :: Benchmark
showCCBench = bench "time to show the wingsCC"
            $ nf (BC.pack . show) wingsCC

hashCCBench :: Benchmark
hashCCBench = bench "time to keccak the shown wingsCC"
            $ nf hash (BC.pack . show $ wingsCC)

hashCCShortBench :: Benchmark
hashCCShortBench = bench "time to keccak the encoded wingsCC"
                 $ nf hash (BL.toStrict $ encode wingsContract)

sipCCBench :: Benchmark
sipCCBench = bench "time to siphash the wingsCC"
           $ nf (sipHash (SipKey 0x8888 0x1432)) (BC.pack $ show wingsCC)

readCC :: BC.ByteString -> CodeCollection
readCC bStr =
  let file = either (error . show) id $ runParser solidityFile "" "" $ BC.unpack bStr
      namedContracts = [(T.unpack name, fromRight (error "Didn't parse xabiToContract!") $ xabiToContract(T.unpack name) (map T.unpack parents') "" xabi)
                        | NamedXabi name (xabi, parents') <- unsourceUnits file]

  in fromRight (error "Didn't parse wingsCC!") . applyInheritance . CodeCollection $ M.fromList namedContracts


readCCBench :: Benchmark
readCCBench = bench "time to read the wingsCC"
            $ nf readCC (BC.pack $ wingsContract)

decodeCC :: BL.ByteString -> CodeCollection
decodeCC = readCC . BL.toStrict

main :: IO ()
main = do
  defaultMain [strHashBench, strSipBench
                   , parseBench, strBench
                   , hashCCShortBench, hashCCBench, sipCCBench
                   , showCCBench, readCCBench
                   ]
  print (length wingsContract, length (show wingsCC), BL.length (encode wingsContract))
