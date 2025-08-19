{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Components.Input where

import Control.Lens
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import Reflex.Dom

input' :: MonadWidget t m => Dynamic t (Map Text Text) -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
input' inputPropsDyn inner =
  -- TODO: asChild should be slot
  elDynAttr' "input" (M.adjust ("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm " <>) "class" <$> inputPropsDyn) inner

input :: MonadWidget t m => InputElementConfig EventResult t (DomBuilderSpace m) -> m (InputElement EventResult (DomBuilderSpace m) t)
input inputConfig = do
  -- TODO: asChild should be slot
  let alterAttrs = M.adjust ("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm " <>) (AttributeName Nothing "class")
  inputElement $ inputConfig & inputElementConfig_elementConfig . elementConfig_initialAttributes %~ alterAttrs