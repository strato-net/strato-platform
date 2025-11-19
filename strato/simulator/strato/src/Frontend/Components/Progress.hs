{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Progress where

import Control.Lens
import Data.Default
import Data.Text (Text)
import qualified Data.Text as T
import Reflex.Dom
import Text.Printf

data ProgressProps = ProgressProps
  { _pp_value :: Double
  , _pp_class :: Text
  } deriving (Eq, Ord)

instance Default ProgressProps where
  def = ProgressProps 0.0 ""

makeLenses ''ProgressProps

progress :: MonadWidget t m => Dynamic t ProgressProps -> m a -> m a
progress propsDyn inner = elDynClass "div"
    (("relative w-full overflow-hidden rounded-full bg-secondary "
     <>) . _pp_class <$> propsDyn) $
  elDynAttr "div" (ffor propsDyn $ \props ->
         "class" =: "h-full w-full flex-1 bg-primary transition-all"
      <> "style" =: ("transform: translateX(-"
        <> (T.pack . printf "%.02f" $ 100.0 - props ^. pp_value)
        <> "%);")
    ) inner