{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Components.EllipsizeText where

import Reflex.Dom
import Data.Maybe (maybeToList)
import Data.Text (Text)
import qualified Data.Text as T

-- | Render text with ellipsizing (CSS handles truncation).
-- Tooltip shows the full value on hover.
ellipsizeText :: MonadWidget t m => Text -> Maybe Text -> m ()
ellipsizeText val mExtraClasses = do
  let tooltipClass = T.unwords $
        ["text-tooltip", "text-left"] ++ maybeToList mExtraClasses
  elAttr "span"
    ("class" =: tooltipClass
    <> "title" =: val) $
      elAttr "span" ("style" =: "white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: 100%;") $
        text val