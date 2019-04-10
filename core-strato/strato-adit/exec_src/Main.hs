{-# LANGUAGE TemplateHaskell #-}

import           Blockchain.Mining.Options ()
import           Blockchain.Output

import           HFlags

import           Executable.StratoAdit

main :: IO ()
main = do
  _ <- $initHFlags "Pluggable mining module for Strato"
  runLoggingT stratoAdit

