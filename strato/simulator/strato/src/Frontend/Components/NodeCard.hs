{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Components.NodeCard where

import qualified Data.Text as T
import Data.Bool (bool)
import Control.Monad (when)
import Frontend.Components.PeersCard
import Frontend.Types.State
import Reflex.Dom

nodeCard :: MonadWidget t m => NodeState -> m ()
nodeCard config = do
  rec
    let arrowClass isOpen = T.unwords
          [ "col-xs-3 text-right pt-icon-standard"
          , bool "pt-icon-caret-down" "pt-icon-caret-up" isOpen
          ]

    (_, isOpenDyn) <- elClass "div" "pt-card pt-elevation-2 node-success pt-interactive" $ do
      (e, _) <- el' "div" $ do
        elClass "div" "col-sm-6" $ do
          el "h3" $ text $ "Peers (" <> T.pack (show $ length (nodePeers config)) <> ")"
          dynText =<< mapDynM (\open -> pure $ if open then "Close" else "Expand") isOpenDyn
          elDynAttr "span" (fmap (\open -> "class" =: arrowClass open) isOpenDyn) blank
      let clickEv' = domEvent Click e
      isOpenDyn' <- toggle False clickEv'
      pure (clickEv', isOpenDyn')

    dyn_ $ ffor isOpenDyn $ \isOpen ->
      when isOpen $ do
        elClass "div" "peers-card" . peersCard $ nodePeers config

  pure ()