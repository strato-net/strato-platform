{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Row where

import Control.Lens
import Data.Bool (bool)
import Data.Default
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T
import Reflex.Dom

data RowAlign = RATop
              | RAMiddle
              | RABottom
              | RAStretch

makePrisms ''RowAlign

instance Default RowAlign where
  def = RATop

instance Show RowAlign where
  show RATop = "top"
  show RAMiddle = "middle"
  show RABottom = "bottom"
  show RAStretch = "stretch"

data RowJustify = RJStart
                | RJEnd
                | RJCenter
                | RJSpaceAround
                | RJSpaceBetween
                | RJSpaceEvenly

makePrisms ''RowJustify

instance Show RowJustify where
  show RJStart = "start"
  show RJEnd = "end"
  show RJCenter = "center"
  show RJSpaceAround = "space-around"
  show RJSpaceBetween = "space-between"
  show RJSpaceEvenly = "space-evenly"

instance Default RowJustify where
  def = RJStart

data RowResponsive = RRXXL
                   | RRXL
                   | RRLG
                   | RRMD
                   | RRSM
                   | RRXS

makePrisms ''RowResponsive

data RowProps = RowProps
  { _rpPrefixClass :: Maybe Text
  , _rpJustify     :: Maybe RowJustify
  , _rpAlign       :: Maybe RowAlign
  , _rpClassName   :: Text
  , _rpStyle       :: Text
  , _rpGutter      :: Integer
  , _rpWrap        :: Bool
  }

makeLenses ''RowProps

instance Default RowProps where
  def = RowProps Nothing Nothing Nothing "" "" 0 False

rowPropsAttrs :: RowProps -> Map Text Text
rowPropsAttrs RowProps{..} = M.fromList
  [ ("class", T.concat [ bool "" (prefix "no-wrap") _rpWrap
                       , maybe "" (prefix . T.pack . show) _rpJustify
                       , maybe "" (prefix . T.pack . show) _rpAlign
                       , _rpClassName
                       ])
  , ("style", _rpStyle)
  ]
  where prefix x = "row-" <> maybe "" (<> "-") _rpPrefixClass <> x 

row' :: MonadWidget t m => Dynamic t RowProps -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
row' rowPropsDyn inner =
  -- TODO: asChild should be slot
  elDynAttr' "div" (rowPropsAttrs <$> rowPropsDyn) inner

row :: MonadWidget t m => Dynamic t RowProps -> m a -> m a
row rowPropsDyn inner = snd <$> row' rowPropsDyn inner
