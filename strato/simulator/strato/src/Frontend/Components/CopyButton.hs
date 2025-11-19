{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.CopyButton where

import Control.Lens
import Data.Default
import Frontend.Components.SVG.Copy
import Frontend.Components.SVG.CopyCheck
import Reflex.Dom

copyButton :: MonadWidget t m => a -> m ()
copyButton _ = mdo
  copied <- holdDyn False $ leftmost [True <$ clickEv, False <$ blurEv, False <$ timeoutEv]
  let class' = fmap ("ml-1 transition-colors duration-200 " <>) . ffor copied $ \case
        True -> "text-green-600"
        False -> "text-gray-400 hover:text-gray-600"
  (e, _) <- elDynAttr' "button" (ffor class' $ \cl ->
         "class" =: cl
      <> "aria-label" =: "Copy address"
    ) . dyn . ffor copied $ \case
      True -> copyCheck $ def & svg_size .~ 14
      False -> copy $ def & svg_size .~ 14
  let clickEv = domEvent Click e
      blurEv = domEvent Blur e
  timeoutEv <- debounce 1.2 clickEv
  pure ()