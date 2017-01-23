{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
  , TypeApplications
#-}

module BlockApps.Bloc.API.Server where

import Control.Concurrent.STM
import Control.Monad.IO.Class
import Crypto.KDF.BCrypt
import Crypto.Secp256k1
import qualified Data.Set as Set
import qualified Data.Text.Encoding as Text
import Network.Wai.Handler.Warp
import Servant

import BlockApps.Bloc.API
import BlockApps.Bloc.Store
import BlockApps.Bloc.User
import BlockApps.Data

bloc :: IO ()
bloc = do
  store <- atomically $ newTVar (Store Set.empty)
  run 8000 (blocApplication store)

blocApplication :: TVar Store -> Application
blocApplication = serve (Proxy @ BlocAPI) . blocServer

blocServer :: TVar Store -> Server BlocAPI
blocServer store =
    getUsers
    :<|> postUser
    :<|> getUserAddresses
    :<|> postSend
    :<|> getContracts
    :<|> getContractData
    :<|> postContract
    -- :<|> getContract
    -- :<|> getContractState
    :<|> postContractMethod
    :<|> getAddresses
    where

      getUsers = liftIO . atomically $
        map (UserName . userName) . Set.elems . users <$> readTVar store

      postUser (UserName userName) PostUserParameters{..} = do
        Just sk <- liftIO newSecKey -- don't do partial matching
        let
          pk = derivePubKey sk
          userAddress = deriveAddress pk
        userPasswordHash <- fmap Text.decodeUtf8 . liftIO $
            hashPassword 12 (Text.encodeUtf8 user_password)
        let
          user = User userName userPasswordHash userAddress
          insertUser = Store . Set.insert user . users
        liftIO . atomically $ modifyTVar store insertUser
        return userAddress

      getUserAddresses (UserName userName') = liftIO . atomically
        $ Set.elems
        . Set.map userAddress
        . Set.filter ((== userName') . userName)
        . users <$> readTVar store

      postSend = undefined
      getContracts = undefined
      getContractData = undefined
      postContract = undefined
      -- getContract = undefined
      -- getContractState = undefined
      postContractMethod = undefined
      getAddresses = undefined
