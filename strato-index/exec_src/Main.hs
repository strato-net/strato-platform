{-# LANGUAGE TemplateHaskell #-}

import Control.Monad.Logger
import HFlags

import Blockchain.IOptions ()
import Blockchain.Output
import Executable.StratoIndex

main :: IO ()
main = do
  _ <- $initHFlags "The Strato Indexer"
  flip runLoggingT printLogMsg stratoIndex
