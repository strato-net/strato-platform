{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Components.Popover where

import Control.Lens
import Data.Default
import Data.Text (Text)
import Reflex.Dom

data PopoverProps = PopoverProps
  { _pp_class  :: Text
  , _pp_isOpen :: Bool
  }

instance Default PopoverProps where
  def = PopoverProps "" False

makeLenses ''PopoverProps

popover' :: MonadWidget t m => PopoverProps -> (Dynamic t Bool -> m (Event t Bool, a)) -> m (Element EventResult (DomBuilderSpace m) t, a)
popover' pp inner = mdo
  isOpen <- holdDyn (pp ^. pp_isOpen) openEv
  (e, (openEv, a)) <- el' "div" $ inner isOpen
  pure (e, a)

popover :: MonadWidget t m => PopoverProps -> (Dynamic t Bool -> m (Event t Bool, a)) -> m a
popover pp inner =
  snd <$> popover' pp inner