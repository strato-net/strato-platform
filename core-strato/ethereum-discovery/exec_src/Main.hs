{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import qualified Network.Socket               as S

import           BlockApps.Init
import           Blockchain.Output
import           Executable.EthereumDiscovery
import           HFlags

main :: IO ()
main = do
  blockappsInit "ethereum-discovery"
  _ <- $initHFlags "ethereum-discover"
  S.withSocketsDo $ runLoggingT ethereumDiscovery
