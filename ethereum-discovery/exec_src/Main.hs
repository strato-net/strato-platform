{-# LANGUAGE TemplateHaskell #-}
import           Control.Monad.Logger
import qualified Network.Socket               as S

import           Blockchain.Output
import           Executable.EthereumDiscovery
import           HFlags

main :: IO ()
main = do
  _ <- $initHFlags "ethereum-discover"
  S.withSocketsDo $ flip runLoggingT printLogMsg ethereumDiscovery
