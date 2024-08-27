{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

import Control.Concurrent
import Control.Concurrent.Async
import Control.Concurrent.Lock as L
import Control.Concurrent.STM
import Control.Exception
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Reader
import Data.Cache as C
import Data.IORef
import Strato.VaultProxy.DataTypes
import Strato.VaultProxy.Server.Token
import Test.Hspec

data Sock = Sock (TQueue ()) (TQueue Bool)

data SockException = SockException deriving (Show)

instance Exception SockException

instance HasVirginTokenCall (ReaderT Sock IO) where
  getVirginToken _ _ _ = do
    Sock i o <- ask
    liftIO . atomically $ writeTQueue i ()
    b <- liftIO . atomically $ readTQueue o
    unless b . liftIO $ throwIO SockException
    pure $
      VaultToken
        { accessToken = "",
          expiresIn = 300
        }

runGoodServer :: Sock -> IORef Int -> IO ()
runGoodServer (Sock i o) r = forever $ do
  void . atomically $ readTQueue i
  atomicModifyIORef' r $ \n -> (n + 1, ())
  atomically $ writeTQueue o True

runBadServer :: Sock -> IORef Int -> IO ()
runBadServer (Sock i o) r = forever $ do
  void . atomically $ readTQueue i
  n' <- atomicModifyIORef' r $ \n -> (n + 1, n)
  atomically . writeTQueue o $ n' /= 0

main :: IO ()
main = hspec $ do
  describe "Token tests" $ do
    it "Can call vaulty 10 times successfully" $ do
      vaultLock <- liftIO $ L.new
      tokenCash <- atomically $ C.newCacheSTM Nothing
      let vaultConnection =
            VaultConnection
              { vaultUrl = "",
                httpManager = error "httpManager",
                oauthUrl = "",
                oauthClientId = "dev",
                oauthClientSecret = "",
                oauthReserveSeconds = 13,
                vaultProxyUrl = "",
                vaultProxyPort = 0,
                tokenCache = tokenCash,
                additionalOauth = RawOauth "" "",
                superLock = vaultLock,
                debuggingOn = False
              }
      i <- newTQueueIO
      o <- newTQueueIO
      oauthCallRef <- newIORef (0 :: Int)
      threadsCompleteRef <- newIORef (0 :: Int)
      let sock = Sock i o
      race_
        (runGoodServer sock oauthCallRef)
        ( mapConcurrently_
            ( \_ -> do
                void . flip runReaderT sock $ vaulty vaultConnection
                atomicModifyIORef' threadsCompleteRef (\n -> (n + 1, ()))
            )
            [1 .. (10 :: Int)]
        )
      oauthCalls <- readIORef oauthCallRef
      oauthCalls `shouldSatisfy` (\x -> x == 1 || x == 2) -- TODO: figure out why this is sometimes 2
      threadsComplete <- readIORef threadsCompleteRef
      threadsComplete `shouldBe` 10
    it "Can call vaulty successfully even if a request to the oauth server fails" $ do
      vaultLock <- liftIO $ L.new
      tokenCash <- atomically $ C.newCacheSTM Nothing
      let vaultConnection =
            VaultConnection
              { vaultUrl = "",
                httpManager = error "httpManager",
                oauthUrl = "",
                oauthClientId = "",
                oauthClientSecret = "",
                oauthReserveSeconds = 13,
                vaultProxyUrl = "",
                vaultProxyPort = 0,
                tokenCache = tokenCash,
                additionalOauth = RawOauth "" "",
                superLock = vaultLock,
                debuggingOn = False
              }
      i <- newTQueueIO
      o <- newTQueueIO
      oauthCallRef <- newIORef (0 :: Int)
      threadsCompleteRef <- newIORef (0 :: Int)
      let sock = Sock i o
      race_
        (race_ (runBadServer sock oauthCallRef) (threadDelay 3000000))
        ( mapConcurrently_
            ( \_ -> do
                e <- try $ do
                  void . flip runReaderT sock $ vaulty vaultConnection
                  atomicModifyIORef' threadsCompleteRef (\n -> (n + 1, ()))
                case e of
                  Left (ex :: SomeException) -> putStrLn $ show ex
                  _ -> pure ()
            )
            [1 .. (10 :: Int)]
        )
      oauthCalls <- readIORef oauthCallRef
      oauthCalls `shouldSatisfy` (\x -> x == 2 || x == 3) -- TODO: figure out why this is sometimes 3
      threadsComplete <- readIORef threadsCompleteRef
      threadsComplete `shouldBe` 9
