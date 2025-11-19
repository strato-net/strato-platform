{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Link where

import Control.Lens
import Data.Default
import qualified Data.Map.Strict as M
import Data.Text (Text)
import Reflex.Dom

data LinkProps = LinkProps
  { _lpTo        :: Text
  , _lpRelative  :: Bool
  , _lpClassName :: Text
  }

makeLenses ''LinkProps

instance Default LinkProps where
  def = LinkProps "" False ""

linkPropsAttrs :: LinkProps -> M.Map Text Text
linkPropsAttrs (LinkProps href _ cn) = M.fromList
  [ ("href", href)
  , ("class", cn)
  ]

link' :: MonadWidget t m => Dynamic t LinkProps -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
link' linkPropsDyn inner =
  -- TODO: asChild should be slot
  elDynAttr' "a" (linkPropsAttrs <$> linkPropsDyn) inner

linkWidget :: MonadWidget t m => Dynamic t LinkProps -> m a -> m a
linkWidget linkPropsDyn inner = snd <$> link' linkPropsDyn inner