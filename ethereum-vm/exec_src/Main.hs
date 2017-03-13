{-# LANGUAGE OverloadedStrings, TemplateHaskell, FlexibleContexts #-}

import Control.Monad.Logger
import HFlags

import Blockchain.Output
import Blockchain.VMOptions
import Executable.EthereumVM
import Executable.EVMFlags

main :: IO ()
main = do
  _ <- $initHFlags "Ethereum VM"
  runLoggingT ethereumVM (printLogMsg' True True)
