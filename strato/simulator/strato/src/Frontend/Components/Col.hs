{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Col where

import Control.Lens
import Data.Default
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T
import Reflex.Dom

type ColSpanType = Either Integer Text

data FlexType = FlexNone | FlexAuto | FlexNumber Integer

data ColSize = ColSize
  { _csFlex :: Maybe FlexType
  , _csSpan :: Maybe ColSpanType
  , _csOrder :: Maybe ColSpanType
  , _csOffset :: Maybe ColSpanType
  , _csPush :: Maybe ColSpanType
  , _csPull :: Maybe ColSpanType
  }

makeLenses ''ColSize

instance Default ColSize where
  def = ColSize Nothing Nothing Nothing Nothing Nothing Nothing

data ColProps = ColProps
  { _cpPrefixClass :: Maybe Text
  , _cpColSize     :: ColSize
  , _cpStyle       :: Text
  , _cpClassName   :: Text
  }

makeLenses ''ColProps

instance Default ColProps where
  def = ColProps Nothing def "" ""

colPropsAttrs :: ColProps -> Map Text Text
colPropsAttrs (ColProps pc ColSize{..} st cn) = M.fromList
  [ ("class", T.concat [ maybe "" preE _csSpan
                       , maybe "" preE _csOrder
                       , maybe "" preE _csOffset
                       , maybe "" preE _csPush
                       , maybe "" preE _csPull
                       , cn
                       ])
  , ("style", st)
  ]
  where prefix x = "col-" <> maybe "" (<> "-") pc <> x 
        preE = prefix . either (T.pack . show) id

col' :: MonadWidget t m => Dynamic t ColProps -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
col' colPropsDyn inner =
  -- TODO: asChild should be slot
  elDynAttr' "div" (colPropsAttrs <$> colPropsDyn) inner

col :: MonadWidget t m => Dynamic t ColProps -> m a -> m a
col colPropsDyn inner = snd <$> col' colPropsDyn inner
