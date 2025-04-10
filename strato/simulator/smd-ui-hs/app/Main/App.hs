{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Main.App where

import Reflex.Dom.Core
import qualified Data.Text as T
import qualified Data.Map as Map
import State.Store
import Routing

-- | Route configuration mapping URLs to routes
routeConfig :: Map.Map T.Text Route
routeConfig = Map.fromList
  [ ("/", Dashboard)
  , ("/accounts", Accounts)
  , ("/contracts", Contracts)
  , ("/blocks", Blocks)
  ]

-- | Initial route event that never fires
routeEvent :: Reflex t => Event t Route
routeEvent = never

-- Main application widget
mainWidget :: MonadWidget t m => m ()
mainWidget = do
  -- Initialize state
  stateDyn <- stateManager
  
  -- Create route state
  routeDyn <- foldDyn ($) Dashboard $ leftmost
    [ const <$> routeEvent
    , const <$> routeChangeEvent
    ]
  
  -- Main container
  elAttr "div" (Map.singleton "class" "container") $ do
    -- Router
    router routeDyn stateDyn

  where
    routeChangeEvent = never  -- TODO: Implement proper routing
