{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.SVG where

import Reflex.Dom hiding (button)
import Control.Lens
import Data.Default
import Data.List (intercalate)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T

data ViewBox = ViewBox
  { _viewbox_x :: Int
  , _viewbox_y :: Int
  , _viewbox_w :: Int
  , _viewbox_h :: Int
  } deriving (Eq, Ord)

instance Show ViewBox where
  show (ViewBox x y w h) = intercalate " "
    [ show x
    , show y
    , show w
    , show h
    ]

instance Default ViewBox where
  def = ViewBox 0 0 24 24

makeLenses ''ViewBox

data SVGProps = SVGProps
  { _svg_width           :: Int
  , _svg_height          :: Int
  , _svg_viewbox         :: ViewBox
  , _svg_fill            :: Text
  , _svg_stroke          :: Text
  , _svg_stroke_width    :: Int
  , _svg_stroke_linecap  :: Text
  , _svg_stroke_linejoin :: Text
  , _svg_class           :: Text
  } deriving (Eq, Ord, Show)

instance Default SVGProps where
  def = SVGProps 24 24 def "none" "currentColor" 2 "round" "round" ""

makeLenses ''SVGProps

svg_size :: Lens' SVGProps Int
svg_size = lens getter setter
  where getter s   = max (s ^. svg_width) (s ^. svg_height)
        setter s b = s & svg_width .~ b
                       & svg_height .~ b
                       -- & svg_viewbox . viewbox_w .~ b
                       -- & svg_viewbox . viewbox_h .~ b

elSvgAttr :: MonadWidget t m => Text -> M.Map Text Text -> m a -> m a
elSvgAttr elTag attrs = fmap snd . elDynAttrNS' (Just "http://www.w3.org/2000/svg") elTag (constDyn attrs)

svg :: MonadWidget t m => SVGProps -> m a -> m a
svg s inner =
  elSvgAttr "svg" ( ("width" =: tshow (s ^. svg_width))
                 <> ("height" =: tshow (s ^. svg_height))
                 <> ("viewBox" =: tshow (s ^. svg_viewbox))
                 <> ("fill" =: s ^. svg_fill)
                 <> ("stroke" =: s ^. svg_stroke)
                 <> ("stroke-width" =: tshow (s ^. svg_stroke_width))
                 <> ("stroke-linecap" =: s ^. svg_stroke_linecap)
                 <> ("stroke-linejoin" =: s ^. svg_stroke_linejoin)
                 <> ("class" =: s ^. svg_class)
                  ) $ inner
  where tshow :: Show a => a -> Text
        tshow = T.pack . show

type SVGIcon t m = MonadWidget t m => SVGProps -> m ()