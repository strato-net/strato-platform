{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.API.Server where

import Control.Concurrent.STM
-- import Control.Monad.IO.Class
-- import Crypto.KDF.BCrypt
-- import Crypto.Secp256k1
import qualified Data.Set as Set
-- import qualified Data.Text.Encoding as Text
import Network.Wai.Handler.Warp
import Servant

import BlockApps.Bloc.API
import BlockApps.Bloc.Store
-- import BlockApps.Bloc.User
-- import BlockApps.Data

bloc :: IO ()
bloc = do
  store <- atomically $ newTVar (Store Set.empty)
  run 8000 (blocApplication store)

blocApplication :: TVar Store -> Application
blocApplication = serve (Proxy @ BlocAPI) . blocServer

blocServer :: TVar Store -> Server BlocAPI
blocServer _store = undefined
