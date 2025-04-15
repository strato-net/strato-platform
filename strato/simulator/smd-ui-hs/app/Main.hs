{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Main where

import Backend.API
import Backend.Handlers
import Bloc.Monad (BlocEnv(..))
import BlockApps.Logging
-- import Blockchain.Data.PubKey
import Blockchain.Options (flags_address, flags_listen)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Options ()
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.VMOptions ()
import Control.Monad.Trans.Resource
import Data.Aeson (encode)
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Lazy as BL
import qualified Data.Cache as Cache
import Data.FileEmbed
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import Executable.EVMFlags ()
import Handlers.Metadata (UrlMap)
import Language.Javascript.JSaddle.Warp (run)
import Language.Javascript.JSaddle.WKWebView (run)
import qualified Data.ByteString as BS
import HFlags
import qualified Main.App as App
import Network.Wai
import Network.Wai.Handler.Warp as Wai
import Reflex.Dom.Core (mainWidget, mainWidgetWithCss)
import Servant as Servant
import Strato.Lite.Base.Filesystem
import Strato.Lite.Core
import Strato.Lite.Filesystem
import Strato.Lite.Rest.Server
import System.Clock
import UnliftIO

bitcoinBridgeServer :: Server BitcoinBridgeAPI
bitcoinBridgeServer = getBlockSummaries
                 :<|> getGlobalUtxos
                 :<|> getWalletUtxos
                 :<|> getWalletBalance
                 :<|> getMultisigUtxos
                 :<|> postSendToMultisig
                 :<|> postBitcoinRpcCommand
                 :<|> getMarketplaceTransactions

fullServer :: FilesystemPeer -> CorePeer -> BlocEnv -> UrlMap -> Server (BitcoinBridgeAPI :<|> CombinedAPI)
fullServer f c blocEnv urlMap = bitcoinBridgeServer :<|> (singleNodeRestServer f c blocEnv urlMap) 

api :: Proxy (BitcoinBridgeAPI :<|> CombinedAPI)
api = Proxy

app :: FilesystemPeer -> CorePeer -> BlocEnv -> UrlMap -> Application
app f c blocEnv urlMap = serve api $ fullServer f c blocEnv urlMap

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
  _ <- $initHFlags "STRATO Lite"
  runLoggingT . runResourceT $ do
    let priv = importPrivateKey =<< either (const Nothing) Just (B16.decode "4c0883a69102937d6231471b5dbb6204fe51296170827971cfb39f781a7d5cd0") -- example from Ethereum test vectors
    let pub = fmap derivePublicKey . importPrivateKey =<< either (const Nothing) Just (B16.decode "4c0883a69102937d6331471b5dbb6804fe51296170727971c1b39f78da7d59d0") -- example from Ethereum test vectors
    -- let pub = pointToSecPubKey $ stringToPoint "5a1593c0aa55a19982022879cc3c005ce71e60a82d9b47ed16c35cfeb1822cb5f7bc1571883efb150bf469c0eab1f50ac0943fba233c6f03d03c13958edecb0c" -- matching public key
    
    let shared = deriveSharedKey <$> priv <*> pub
    liftIO $ print ("SHARED KEYYYY" :: String)
    liftIO $ print priv
    liftIO $ print pub
    liftIO $ print $ (\(SharedKey s) -> B16.encode s) <$> shared
    (f,c) <- createFilesystemNode
               "/Users/dustinnorwood/blockchain/strato"
               "mercata-hydrogen"
               "/Users/dustinnorwood/.ssh/strato.pem"
               "dnorwood"
               (fmap (Validator . ("Node" <>)) <$> [ (0x44f1b8c88be13021806e1c3a7a2d5204a1bda57a, "One")
                                                   , (0xdc93154cbfa39b4138b15a8921cf43a8762eacbd, "Two")
                                                   , (0x889f1b7a9ad12141b3ee6551dae5a19cac19d2be, "Three")
                                                   , (0xd4b34e1cdd1592d266ec95baf9195ac0c80b8d4a, "Four")
                                                   ])
               []
               "Dustin's local node"
               (TCPPort flags_listen)
               (UDPPort flags_listen)
               (Host $ T.pack flags_address)
               [Host "3.84.124.109"] -- "44.209.149.47"]
               False

    let stateFetchLimit' = 100
        nonceCounterTimeout = 10

    nonceCache <- liftIO . Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0

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
    $logInfoS "PRIVKEY" . T.pack $ show $ _filesystemPeerPrivKey f
    $logInfoS "PUBKEY" . decodeUtf8 . BL.toStrict . encode . derivePublicKey $ _filesystemPeerPrivKey f
    a <- async $ runFilesystemNode f c
    b <- liftIO . async $ Wai.run 8889 $ app f c env M.empty
    finally (liftIO mainNative) (cancel a >> cancel b)