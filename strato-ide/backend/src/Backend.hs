{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TypeFamilies #-}
module Backend where

import Backend.Server (application)
import Common.Route
import Data.Dependent.Sum (DSum (..))
import Data.Functor.Identity
import Network.WebSockets.Snap
import Obelisk.Backend

backend :: Backend BackendRoute FrontendRoute
backend = Backend
  { _backend_run = \serve -> do
      serve $ \case
        BackendRoute_Missing :=> Identity() -> pure ()
        BackendRoute_IDE :=> Identity () -> do
          runWebSocketsSnap application
  , _backend_routeEncoder = fullRouteEncoder
  }
