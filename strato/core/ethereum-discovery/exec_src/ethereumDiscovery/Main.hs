{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Init
import BlockApps.Logging
import Blockchain.EthConf
import Blockchain.Network (getParams, webAddress)
import Blockchain.Strato.Discovery.ContextLite
import Blockchain.Strato.Discovery.Data.Peer (UDPPort(..), TCPPort(..))
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Blockchain.Strato.Discovery.UDPServer
import Control.Monad.Composable.Vault (runVaultM)
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Resource
import qualified Data.Text as T
import Executable.EthDiscoverySetup (setup)
import Executable.EthereumDiscovery
import Executable.Options ()
import HFlags
import Instrumentation
import qualified Network.Socket as S
import qualified Text.Colors as CL
import UnliftIO (bracket)

main :: IO ()
main = do
  blockappsInit "ethereum-discovery"
  runInstrumentation "ethereum-discovery"
  _ <- $initHFlags "ethereum-discover"

  let networkName = network . networkConfig $ ethConf
  putStrLn $ "ethereum-discover: Network is " ++ networkName
  maybeParams <- getParams networkName
  let bootnodes = case maybeParams of
        Nothing -> []
        Just params -> map webAddress params
  putStrLn $ "ethereum-discover: Using bootnodes: " ++ show bootnodes

  putStrLn "ethereum-discover: Running peer database setup..."
  runStdoutLoggingT $ setup bootnodes
  putStrLn "ethereum-discover: Peer database setup complete"

  let runner f = do
        let vaultUrl' = vaultUrl . urlConfig $ ethConf
        $logInfoS "ethereumDiscovery" $ T.pack $ CL.green $ "Talking to vault at " ++ vaultUrl'
        let port' = discoveryPort $ discoveryConfig ethConf
            udpPort = UDPPort port'
            tcpPort = TCPPort port' -- TODO: where do we get the TCP port from?
            minPeers = minAvailablePeers (discoveryConfig ethConf)
        cxt <- initContextLite udpPort tcpPort
        runVaultM vaultUrl' . runResourceT . flip runReaderT cxt $
          bracket
            (connectMe udpPort)
            (liftIO . S.close)
            (\s -> local (\c -> c {sock = s}) $ f minPeers)
  S.withSocketsDo . runLoggingT $ ethereumDiscovery runner
