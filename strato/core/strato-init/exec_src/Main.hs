{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Logging
import Blockchain.Init.Generator
import Blockchain.Init.Options ()
import Blockchain.Strato.Model.Options (flags_network)
import HFlags

main :: IO ()
main = do
  _ <- $initHFlags "strato-setup"
  runLoggingT $ mkFilesAndGenesis flags_network
