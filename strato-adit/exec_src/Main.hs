{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Output
import Blockchain.Mining.Options ()

import Control.Monad.Logger
import HFlags

import Executable.StratoAdit

main :: IO ()
main = do
  _ <- $initHFlags "Pluggable mining module for Strato"
  flip runLoggingT printLogMsg stratoAdit

