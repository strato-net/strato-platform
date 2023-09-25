{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

--import Data.Either

--import SolidVM.Solidity.Parse.Declarations

--import SolidVM.CodeCollectionTools

import BlockApps.Logging
import Blockchain.MemVMContext
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.SolidVM.Simple
import Blockchain.Strato.Model.Address
import Blockchain.VMOptions ()
import Control.DeepSeq
import Control.Lens
import Criterion.Main
import Data.Binary
import Data.ByteArray.Hash
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.FileEmbed
import qualified Data.Map as M
import qualified Data.Text as T
import HFlags
import SolidVM.Model.CodeCollection
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.StaticAnalysis.Typechecker
import Text.Parsec (ParseError, runParser)

-- for HFlags
-- import Executable.EVMFlags() -- for HFlags

instance NFData ParseError where
  rnf = rwhnf

instance NFData SipHash where
  rnf (SipHash sh) = rnf sh

{-# NOINLINE wingsContract #-}
wingsContract :: String
wingsContract = BC.unpack $(embedFile "bench/wings.sol")

wingsCC :: CodeCollection
wingsCC = do
  let srcMap = M.singleton "Wings.sol" $ T.pack wingsContract
  let compiled = runIdentity . runMemCompilerT $ compileSource False srcMap 
  case compiled of
    Left err -> error $ show err
    Right cc -> cc
   
strBench :: Benchmark
strBench =
  bench "time to pack the wings contract" $
    nf BC.pack wingsContract

createContract :: Benchmark
createContract =
  let txArgs =
        def & createNewAddress .~ (Account (Address 0xdeadbeef) Nothing)
          & createCode .~ (Code $(embedFile "bench/wings.sol"))
          & createArgs . argsMetadata ?~ M.empty
          & createArgs . argsMetadata . _Just . at "name" ?~ "TicketManager"
          & createArgs . argsMetadata . _Just . at "args" ?~ "(0xfeedbeef,0xc001d00d)"
   in bench "time to create a contract" $ nfIO . runLoggingT . runMemContextM Nothing $ create txArgs

callFunc :: Benchmark
callFunc =
  let txArgs =
        def & createNewAddress .~ (Account (Address 0xdeadbeef) Nothing)
          & createCode .~ (Code $(embedFile "bench/wings.sol"))
          & createArgs . argsMetadata ?~ M.empty
          & createArgs . argsMetadata . _Just . at "name" ?~ "TicketManager"
          & createArgs . argsMetadata . _Just . at "args" ?~ "(0xfeedbeef,0xc001d00d)"
      txArgs' =
        def & callArgs . argsBlockData .~ txArgs ^. createArgs . argsBlockData
          & callCodeAddress .~ txArgs ^. createNewAddress
          & callArgs . argsMetadata ?~ M.empty
          & callArgs . argsMetadata . _Just . at "funcName" ?~ "createTicket"
          & callArgs . argsMetadata . _Just . at "args" ?~ "([\"00\",\"01\",\"02\",\"03\",\"04\",\"05\",\"06\",\"07\",\"08\",\"09\",\"0a\",\"0b\",\"0c\",\"0d\"],[14,15,16,17],[\"18\"],[19])"
   in bench "time to call a function" $
        nfIO . runLoggingT . runMemContextM Nothing $ do
          _ <- create txArgs
          call txArgs'

typecheckContracts :: Benchmark
typecheckContracts =
  bench "time to typecheck contracts" $ nf detector wingsCC

strUnpackBench :: Benchmark
strUnpackBench =
  bench "time unpack the wings contrcat" $
    nf BC.unpack (BC.pack wingsContract)

strHashBench :: Benchmark
strHashBench =
  bench "time spent on (keccak) hashing the wings contract" $
    nf hash (BC.pack wingsContract)

strSipBench :: Benchmark
strSipBench =
  bench "time spent on (siphash) hashing the wings contract" $
    nf (sipHash (SipKey 0x8888 0x1432)) (BC.pack wingsContract)

parseBench :: Benchmark
parseBench =
  bench "time required to parse the contract" $
    nf (runParser solidityFile initialParserState "") wingsContract

showCCBench :: Benchmark
showCCBench =
  bench "time to show the wingsCC" $
    nf (BC.pack . show) wingsCC

hashCCBench :: Benchmark
hashCCBench =
  bench "time to keccak the shown wingsCC" $
    nf hash (BC.pack . show $ wingsCC)

hashCCShortBench :: Benchmark
hashCCShortBench =
  bench "time to keccak the encoded wingsCC" $
    nf hash (BL.toStrict $ encode wingsContract)

sipCCBench :: Benchmark
sipCCBench =
  bench "time to siphash the wingsCC" $
    nf (sipHash (SipKey 0x8888 0x1432)) (BC.pack $ show wingsCC)

readCC :: BC.ByteString -> CodeCollection
readCC bStr = do
  let srcMap = M.singleton "Wings.sol" $ T.pack $ BC.unpack bStr
  let compiled = runIdentity . runMemCompilerT $ compileSource False srcMap 
  case compiled of
    Left err -> error $ show err
    Right cc -> cc

readCCBench :: Benchmark
readCCBench =
  bench "time to read the wingsCC" $
    nf readCC (BC.pack $ wingsContract)

decodeCC :: BL.ByteString -> CodeCollection
decodeCC = readCC . BL.toStrict

main :: IO ()
main = do
  _ <- $initHFlags "solid vm benchmarks"
  defaultMain
    [ strHashBench,
      strSipBench,
      parseBench,
      strBench,
      hashCCShortBench,
      hashCCBench,
      sipCCBench,
      showCCBench,
      readCCBench,
      createContract,
      callFunc,
      typecheckContracts
    ]
  print (length wingsContract, length (show wingsCC), BL.length (encode wingsContract))
