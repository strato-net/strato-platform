{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Init
import BlockApps.Logging
import Blockchain.EthConf
import Blockchain.Strato.Discovery.ContextLite
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Blockchain.Strato.Discovery.UDPServer
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Resource
import qualified Data.Text as T
import Executable.EthereumDiscovery
import Executable.Options ()
import HFlags
import Instrumentation
import qualified Network.Socket as S
import qualified Text.Colors as CL
import UnliftIO

main :: IO ()
main = do
  blockappsInit "ethereum-discovery"
  runInstrumentation "ethereum-discovery"
  _ <- $initHFlags "ethereum-discover"

  let runner f = do
        let vaultProxyUrl' = vaultProxyUrl . urlConfig $ ethConf
        $logInfoS "ethereumDiscovery" $ T.pack $ CL.green $ "Talking to vault-wrapper at " ++ show vaultProxyUrl'
        let port' = discoveryPort $ discoveryConfig ethConf
            udpPort = UDPPort port'
            tcpPort = TCPPort port' -- TODO: where do we get the TCP port from?
            minPeers = minAvailablePeers (discoveryConfig ethConf)
        cxt <- initContextLite vaultProxyUrl' udpPort tcpPort
        runResourceT . flip runReaderT cxt $
          bracket
            (connectMe udpPort)
            (liftIO . S.close)
            (\s -> local (\c -> c {sock = s}) $ f minPeers)
  S.withSocketsDo . runLoggingT $ ethereumDiscovery runner
