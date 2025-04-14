{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Main where

import Backend.API
import Backend.Handlers
import Bloc.Monad (BlocEnv(..))
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Validator
import Control.Concurrent
import qualified Data.Cache as Cache
import Data.FileEmbed
import qualified Data.Map.Strict as M
import Handlers.Metadata (UrlMap)
import Language.Javascript.JSaddle.Warp (run)
import Language.Javascript.JSaddle.WKWebView (run)
import qualified Data.ByteString as BS
import qualified Main.App as App
import Network.Wai
import Network.Wai.Handler.Warp as Wai
import Reflex.Dom.Core (mainWidget, mainWidgetWithCss)
import Servant as Servant
import Strato.Lite.Rest.Server
import Strato.Lite.Simulator
import System.Clock

bitcoinBridgeServer :: Server BitcoinBridgeAPI
bitcoinBridgeServer = getBlockSummaries
                 :<|> getGlobalUtxos
                 :<|> getWalletUtxos
                 :<|> getWalletBalance
                 :<|> getMultisigUtxos
                 :<|> postSendToMultisig
                 :<|> postBitcoinRpcCommand
                 :<|> getMarketplaceTransactions

fullServer :: NetworkManager -> BlocEnv -> UrlMap -> Server (BitcoinBridgeAPI :<|> FullAPI)
fullServer mgr blocEnv urlMap = bitcoinBridgeServer :<|> (combinedRestServer mgr blocEnv urlMap) 

api :: Proxy (BitcoinBridgeAPI :<|> FullAPI)
api = Proxy

app :: NetworkManager -> BlocEnv -> UrlMap -> Application
app mgr blocEnv urlMap = serve api $ fullServer mgr blocEnv urlMap

-- CSS file path
css :: BS.ByteString
css = $(embedFile "static/style.css")

-- Main function for browser-based interface
mainBrowser :: IO ()
mainBrowser = do
  putStrLn "Starting browser-based interface..."
  Language.Javascript.JSaddle.Warp.run 3000 $ mainWidget App.mainWidget

-- Main function for native window interface
mainNative :: IO ()
mainNative = do
  putStrLn "Starting native window interface..."
  Language.Javascript.JSaddle.WKWebView.run $ mainWidgetWithCss css App.mainWidget

-- Default main function (can be changed to mainBrowser or mainNative)
main :: IO ()
main = do
  let nodes' = [("Boot", "Admin", "1.2.3.4")]
      nodes'' = (\(a, b, c) -> (a, (Validator b, Host c, TCPPort 30303, UDPPort 30303))) <$> nodes'
  mgr <- runNetwork nodes'' id

  let stateFetchLimit' = 100
      nonceCounterTimeout = 10

  nonceCache <- Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0

  let env =
        BlocEnv
          { txSizeLimit = 150000,
            accountNonceLimit = 1000000,
            gasLimit = 10000000,
            stateFetchLimit = stateFetchLimit',
            globalNonceCounter = nonceCache,
            userRegistryAddress = 0x100,
            userRegistryCodeHash = Nothing,
            useWalletsByDefault = False
          }
  _ <- forkIO $ Wai.run 8889 $ app mgr env M.empty
  mainNative