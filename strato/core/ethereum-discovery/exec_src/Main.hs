{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import qualified Network.Socket               as S

import           BlockApps.Init
import           BlockApps.Logging
import           Executable.EthereumDiscovery
import           Executable.Options()
import           HFlags

main :: IO ()
main = do
  blockappsInit "ethereum-discovery"
  _ <- $initHFlags "ethereum-discover"
  S.withSocketsDo $ runLoggingT ethereumDiscovery
