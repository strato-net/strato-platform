{-# LANGUAGE TemplateHaskell #-}

import Control.Monad.Logger
import HFlags

import Blockchain.Options ()
import Blockchain.Output
import Executable.StratoP2PClient

main::IO ()    
main = do
  args <- $initHFlags "Strato Peer Client"
  flip runLoggingT printLogMsg $ stratoP2PClient args
