{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Main where

import Backend.Handlers
import Bitcoin.TxBuilder
import Bloc.Monad (BlocEnv(..))
import BlockApps.Logging
import Blockchain.Blockstanbul.Options ()
import Blockchain.Options (flags_address, flags_listen)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Common.API
import Control.Monad.Trans.Resource
import Crypto.Random.Entropy
import qualified Data.Binary as Binary
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
import qualified Data.ByteString.Lazy as BL
import Haskoin.Address
import Haskoin.Crypto
import Haskoin.Script
import Haskoin.Util
import HFlags
import qualified Main.App as App
import Network.Wai
import Network.Wai.Handler.Warp as Wai
import Reflex.Dom.Core
import Servant as Servant
import Strato.Lite.Base.Filesystem
import Strato.Lite.Core
import Strato.Lite.Filesystem
import Strato.Lite.Rest.Server
import System.Clock
import UnliftIO

createHaskoinMultiSigScript :: IO ()
createHaskoinMultiSigScript = do
  ctx <- createContext
  utxos <- listWalletUtxos
  putStrLn $ "Got UTXOs: " ++ show utxos

  -- Example 2-of-3 multisig script
  key1 <- PrivateKey <$> (SecKey <$> getEntropy 32) <*> pure False
  key2 <- PrivateKey <$> (SecKey <$> getEntropy 32) <*> pure False
  key3 <- PrivateKey <$> (SecKey <$> getEntropy 32) <*> pure False

  let pub1 = derivePublicKey ctx key1
      pub2 = derivePublicKey ctx key2
      pub3 = derivePublicKey ctx key3
      redeemScript = PayMulSig [pub1, pub2, pub3] 2
      addr1 = case pubKeyAddr ctx pub1 of
        PubKeyAddress a -> a
        _ -> error "Impossible!"

  let amount = 0.0001 -- BTC

  case buildUnsignedTx ctx utxos redeemScript amount (PayPKHash addr1) of
    Left err -> putStrLn $ "❌ " ++ err
    Right tx -> do
      putStrLn $ "Got redeemScript: " ++ show redeemScript
      putStrLn $ "Got Tx: " ++ show tx
      putStrLn $ "✅ Unsigned tx: " ++ T.unpack (encodeHex (BL.toStrict $ Binary.encode tx))

bitcoinBridgeServer :: Server BitcoinBridgeAPI
bitcoinBridgeServer = getBlockSummaries
                 :<|> getGlobalUtxos
                 :<|> getWalletUtxos
                 :<|> getWalletBalance
                 :<|> getMultisigUtxos
                 :<|> postSendToMultisig
                 :<|> postBitcoinRpcCommand
                 :<|> getMarketplaceTransactions

fullServer :: FilePath -> FilesystemPeer -> CorePeer -> BlocEnv -> UrlMap -> Server (BitcoinBridgeAPI :<|> (CombinedAPI :<|> CirrusAPI))
fullServer d f c blocEnv urlMap = bitcoinBridgeServer :<|> (singleNodeRestServer d f c blocEnv urlMap) 

api :: Proxy (BitcoinBridgeAPI :<|> (CombinedAPI :<|> CirrusAPI))
api = Proxy

app :: FilePath -> FilesystemPeer -> CorePeer -> BlocEnv -> UrlMap -> Application
app d f c blocEnv urlMap = serve api $ fullServer d f c blocEnv urlMap

-- CSS file path
css :: BS.ByteString
css = $(embedFile "static/style.css")

appCss :: BS.ByteString
appCss = $(embedFile "static/App.css")

header :: MonadWidget t m => m ()
header = do
  elAttr "meta" ("charset" =: "UTF-8") blank
  elAttr "meta" (("name" =: "viewport") <> ("content" =: "width=device-width, initial-scale=1.0")) blank
  elAttr "script" ("src" =: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4") blank
  el "style" $ text $ decodeUtf8 appCss
  el "style" $ text $ decodeUtf8 css

-- Main function for browser-based interface
mainBrowser :: IO ()
mainBrowser = do
  putStrLn "Starting browser-based interface..."
  Language.Javascript.JSaddle.Warp.run 3000 $ mainWidgetWithHead header App.mainWidget

-- Main function for native window interface
mainNative :: IO ()
mainNative = do
  putStrLn "Starting native window interface..."
  Language.Javascript.JSaddle.WKWebView.run $ mainWidgetWithHead header App.mainWidget

-- Default main function (can be changed to mainBrowser or mainNative)
main :: IO ()
main = do
  _ <- $initHFlags "STRATO Lite"
  -- createHaskoinMultiSigScript
  let sqlitePath = "strato.sqlite"
  runLoggingT . runResourceT $ do
    (f,c) <- createFilesystemNode
               "/Users/dustinnorwood/blockchain/strato"
               sqlitePath
               "mercata-francium"
               "/Users/dustinnorwood/.ssh/strato.pem"
               "dnorwood"
               "Dustin's local node"
               (TCPPort flags_listen)
               (UDPPort flags_listen)
               (Host $ T.pack flags_address)
               [Host "44.209.149.47"] --  "3.84.124.109"]
               True

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
    a <- runFilesystemNode f c
    b <- liftIO . async $ Wai.run 8889 $ app sqlitePath f c env M.empty
    finally (liftIO mainNative) (traverse cancel a >> cancel b)