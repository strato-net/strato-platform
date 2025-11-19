{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Common.Route where

import Prelude hiding (id, (.))
import Common.Encoder
import Control.Category
import Control.Lens
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import GHC.Generics (Generic)

-- Top-level sections
data Route
  = RouteApp AppRoute
  | RouteSMD SMDRoute
  | RouteBridge BridgeRoute
  deriving (Eq, Show, Generic)

serializeRoute :: Route -> Text
serializeRoute = routeSerializer ^. encode

deserializeRoute :: Text -> Maybe Route
deserializeRoute = routeSerializer ^. decode

routeSerializer :: Serializer Route
routeSerializer = routePathEncoder . routeEncoder

routeEncoder :: Encoder Route
routeEncoder = Encoder
  { _encode = \r -> case r of
      RouteApp    ar -> case (appRouteEncoder ^. encode) ar of
        RoutePath p q -> RoutePath p q
      RouteSMD    sr -> case (smdRouteEncoder ^. encode) sr of
        RoutePath p q -> RoutePath ("smd":p) q
      RouteBridge br -> case (bridgeRouteEncoder ^. encode) br of
        RoutePath p q -> RoutePath ("bridge":p) q
  , _decode = \(RoutePath p q) -> case p of
      []     -> Nothing
      (t:p') -> case t of
        "smd"    -> Just . RouteSMD . fromMaybe SMDDashboard $ (smdRouteEncoder ^. decode) (RoutePath p' q)
        "bridge" -> Just . RouteBridge . fromMaybe BridgeOverview $ (bridgeRouteEncoder ^. decode) (RoutePath p' q)
        _        -> RouteApp    <$> (appRouteEncoder    ^. decode) (RoutePath p  q)
  }

-- Marketplace
data AppRoute
  = AppHome
  | AppDashboard AppDashboardRoute
  deriving (Eq, Show, Generic)

appRouteEncoder :: Encoder AppRoute
appRouteEncoder = Encoder
  { _encode = \r -> case r of
      AppHome          -> RoutePath [] []
      AppDashboard adr -> case (appDashboardRouteEncoder ^. encode) adr of
        RoutePath p q -> RoutePath ("dashboard":p) q
  , _decode = \(RoutePath p q) -> case p of
      []     -> Just $ AppHome
      (t:p') -> case t of
        "dashboard" -> Just . AppDashboard . fromMaybe AppOverview $ (appDashboardRouteEncoder ^. decode) (RoutePath p' q)
        _           -> Nothing
  }

data AppDashboardRoute
  = AppOverview
  | AppDeposits
  | AppTransfer
  | AppBorrow
  | AppSwap
  | AppPools
  | AppActivityFeed
  | AppAdmin
  deriving (Eq, Show, Enum, Bounded, Generic)

appOverviewRoute :: Route
appOverviewRoute = RouteApp $ AppDashboard AppOverview

appDashboardRouteEncoder :: Encoder AppDashboardRoute
appDashboardRouteEncoder = enumEncoder $ \case
  AppOverview -> ""
  AppDeposits -> "deposits"
  AppTransfer -> "transfer"
  AppBorrow -> "borrow"
  AppSwap -> "swap"
  AppPools -> "pools"
  AppActivityFeed -> "activityFeed"
  AppAdmin -> "admin"

-- STRATO Management Dashboard (SMD)
data SMDRoute
  = SMDDashboard
  | SMDUsers
  | SMDTransactions
  | SMDContracts
  | SMDBlocks
  | SMDContractEditor
  deriving (Eq, Show, Enum, Bounded, Generic)

smdRouteEncoder :: Encoder SMDRoute
smdRouteEncoder = enumEncoder $ \case
  SMDDashboard -> "dashboard"
  SMDUsers -> "users"
  SMDTransactions -> "transactions"
  SMDContracts -> "contracts"
  SMDBlocks -> "blocks"
  SMDContractEditor -> "editor"

-- Bitcoin Bridge
data BridgeRoute
  = BridgeOverview
  | BridgeBridge
  | BridgeRPC
  deriving (Eq, Show, Enum, Bounded, Generic)

bridgeRouteEncoder :: Encoder BridgeRoute
bridgeRouteEncoder = enumEncoder $ \case
  BridgeOverview -> "overview"
  BridgeBridge -> "bridge"
  BridgeRPC -> "rpc"