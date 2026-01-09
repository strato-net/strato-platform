{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Run where

import Backend.Handlers
import Backend.Server
import Bitcoin.TxBuilder
import Bloc.Monad (BlocEnv(..))
import BlockApps.Logging
import Blockchain.Blockstanbul.Options ()
import Blockchain.Options (flags_address, flags_listen)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Options (flags_network)
import qualified Blockchain.Strato.Model.Secp256k1 as S
import Blockchain.VMOptions ()
import Common.API
import Control.Monad (unless, when)
import Control.Monad.Trans.Resource
import Crypto.Random.Entropy
import Data.Bifunctor (first)
import qualified Data.Binary as Binary
import Data.Bool (bool)
import qualified Data.Cache as Cache
import Data.FileEmbed
import Data.Foldable (traverse_)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import Executable.EVMFlags ()
import Handlers.Metadata (UrlMap)
import Language.Javascript.JSaddle.Monad (JSM)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import Haskoin.Address
import Haskoin.Crypto
import Haskoin.Script
import Haskoin.Util
import Network.Wai
import Network.Wai.Handler.Warp as Wai
import Reflex.Dom.Core
import Servant as Servant
import qualified Strato.App as App
import Strato.Lite.Base.Filesystem
import Strato.Lite.Base.Memory
import Strato.Lite.Core
import Strato.Lite.Filesystem
import Strato.Lite.Memory
import Strato.Lite.Rest.Server
import Strato.Lite.Utils
import Strato.Options
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

-- CSS file path
css :: BS.ByteString
css = $(embedFile "static/style.css")

header :: MonadWidget t m => m ()
header = do
  elAttr "meta" ("charset" =: "UTF-8") blank
  elAttr "meta" (("name" =: "viewport") <> ("content" =: "width=device-width, initial-scale=1.0")) blank
  elAttr "script" ("src" =: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4") blank
  el "style" $ text $ decodeUtf8 css

-- Default main function (can be changed to mainBrowser or mainNative)
runStrato :: (JSM () -> IO ()) -> IO ()
runStrato runUI = do
  -- createHaskoinMultiSigScript
  runLoggingT . runResourceT $ do
    if flags_logs /= ""
      then getLogs flags_directory flags_network flags_username flags_logs flags_tail
      else runStratoNode runUI

runStratoNode :: (JSM () -> IO ()) -> ResourceT (LoggingT IO) ()
runStratoNode runUI = do
  when (flags_wipe || flags_resync) $ do
    catch ((bool wipeFilesystemNode wipeMemoryNode flags_in_memory) flags_directory flags_network flags_username)
          (\(_ :: SomeException) -> pure ())
    liftIO . putStrLn $ concat
      [ "Node "
      , flags_username
      , " on network "
      , flags_network
      , " successfully wiped"
      ]
  unless flags_wipe $ do
    (f,c) <- if flags_in_memory
      then first Right <$> createMemoryNode
               flags_directory
               flags_network
               flags_private_key
               (T.pack flags_username)
               (TCPPort flags_listen)
               (UDPPort flags_listen)
               (Host $ T.pack flags_address)
               True
      else first Left <$> createFilesystemNode
               flags_directory
               flags_network
               flags_private_key
               (T.pack flags_username)
               (TCPPort flags_listen)
               (UDPPort flags_listen)
               (Host $ T.pack flags_address)
               True

    let stateFetchLimit' = 100
        nonceCounterTimeout = 10

    nonceCache <- liftIO . Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0

    let env =
          BlocEnv
            { txSizeLimit = 150000,
              gasLimit = 10000000,
              stateFetchLimit = stateFetchLimit',
              globalNonceCounter = nonceCache,
              nodePubKey = S.derivePublicKey $ either _filesystemPeerPrivKey _memoryPeerPrivKey f
            }
    as <- liftIO $ (either runFilesystemNode runMemoryNode) f c
    a <- liftIO . async $ Wai.run flags_backend_port $
      app f c env M.empty
    let finalize = do
          putStrLn "Cancelling threads..."
          traverse_ cancel $ a:as
          putStrLn "Done cancelling threads"
    finally (liftIO $ runStratoUI runUI) $ liftIO finalize

runStratoUI :: (JSM () -> IO ()) -> IO ()
runStratoUI runUI = runUI $ mainWidgetWithHead header App.mainWidget

fullServer :: Either FilesystemPeer MemoryPeer -> CorePeer -> BlocEnv -> UrlMap -> Server (BitcoinBridgeAPI :<|> MercataAPI :<|> (CombinedAPI :<|> CirrusAPI))
fullServer f c blocEnv urlMap = bitcoinBridgeServer :<|> mercataServer :<|> ((either filesystemNodeRestServer memoryNodeRestServer f) c blocEnv urlMap)

api :: Proxy (BitcoinBridgeAPI :<|> MercataAPI :<|> (CombinedAPI :<|> CirrusAPI))
api = Proxy

app :: Either FilesystemPeer MemoryPeer -> CorePeer -> BlocEnv -> UrlMap -> Application
app f c blocEnv urlMap = serve api $ fullServer f c blocEnv urlMap