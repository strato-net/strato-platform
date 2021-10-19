{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Monad
import           Control.Concurrent.Async             as Async
import           Data.Functor.Identity                (Identity(..))
import qualified Data.Map.Strict                      as M
import           Debugger
import           Debugger.Options() -- HFlags
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Handler.Warp
import           HFlags

import           BlockApps.Init
import           Blockchain.Output
import           Blockchain.SolidVM.CodeCollectionDB
import           Blockchain.VMOptions() -- HFlags
import           Executable.EthereumVM
import           Executable.EVMFlags() -- HFlags
import           SolidVM.Solidity.Detectors
import           SolidVM.Solidity.Fuzzer

main :: IO ()
main = do
  blockappsInit "vm_main"
  void $ $initHFlags "Ethereum VM"
  let parse = fmap concat
            . traverse (uncurry parseSourceWithAnnotations)
            . unSourceMap
      compile = compileSourceWithAnnotations
              . M.fromList
              . unSourceMap
      analyze = Identity . runDetectors parse compile id
      fuzz = runFuzzer compile
      tools = SourceTools compile analyze fuzz
  mDebugger <- initializeDebugger tools
  let metricsRunner = run 8000 metricsApp
      debugSettings = fst <$> mDebugger
      helpers = case snd <$> mDebugger of
        Nothing -> metricsRunner
        Just debuggerRunner -> race_ metricsRunner debuggerRunner
      runVM = runLoggingT $ ethereumVM debugSettings
  race_ helpers runVM
