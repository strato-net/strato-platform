{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# OPTIONS -fno-warn-unused-imports #-} -- #justHFlagsThingz

import           Control.Monad.Logger
import           HFlags

import           Blockchain.Output
import           Blockchain.VMOptions
import           Executable.EthereumVM
import           Executable.EVMFlags

main :: IO ()
main = do
  s <- $initHFlags "Ethereum VM"
  runLoggingT ethereumVM printLogMsg
