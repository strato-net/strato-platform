{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Mining.Options ()

import           HFlags

import           Executable.StratoAdit

main :: IO ()
main = do
  blockappsInit "strato-adit"
  _ <- $initHFlags "Pluggable mining module for Strato"
  runLoggingT stratoAdit

