{-# LANGUAGE TemplateHaskell #-}

import Control.Monad.Logger
import HFlags

import Blockchain.IOptions ()
import Blockchain.Output
import Executable.StratoIndex

main :: IO ()
main = do
  _ <- $initHFlags "The Strato Indexer"
  runLoggingT stratoIndex (printLogMsg' True True)
