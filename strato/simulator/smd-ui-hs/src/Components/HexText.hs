{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecursiveDo #-}

module Components.HexText where

import Reflex.Dom
import Control.Lens ((^.))
import Data.Text (Text)
import Language.Javascript.JSaddle (liftJSM, js, jsg, js1)
import Components.EllipsizeText (ellipsizeText)

-- | Hex text widget with copy-to-clipboard and tooltip
hexText :: MonadWidget t m => Text -> Maybe Text -> m ()
hexText val mExtraClasses = mdo
  -- Tracks copy state
  copiedDyn <- holdDyn False $ leftmost [True <$ copyClick, False <$ mouseOutEv]

  -- Clipboard icon + tooltip
  (copyClick, mouseOutEv) <- elClass "span" "hex-text smd-pointer" $ do
    (copyEl, _) <- el' "span" $ do
      tooltip <- sample . current $ copiedDyn
      let tipText = if tooltip then "Copied!" else "Copy to clipboard"
      elAttr "span"
        ("class" =: "pt-icon pt-icon-clipboard"
         <> "title" =: tipText) blank
    let clickEvent = domEvent Click copyEl
        mouseOut = domEvent Mouseout copyEl

    performEvent_ $ ffor clickEvent $ \_ ->
      liftJSM $ do
        _ <- jsg ("navigator" :: Text) ^. js ("clipboard" :: Text) . js1 ("writeText" :: Text) val
        pure ()
    pure (clickEvent, mouseOut)

  -- Ellipsized value with full-value tooltip
  ellipsizeText val mExtraClasses