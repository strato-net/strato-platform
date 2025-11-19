{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Components.Tabs where

import Control.Lens ((<&>))
import Data.Bool (bool)
import Data.Text (Text)
import Reflex.Dom

tabs' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tabs' classNameDyn inner = elDynClass' "div" classNameDyn inner

tabs :: MonadWidget t m => Dynamic t Text -> m a -> m a
tabs classNameDyn inner = snd <$> tabs' classNameDyn inner

tabsList' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tabsList' classNameDyn inner =
  elDynClass' "div" (("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground " <>) <$> classNameDyn)
    inner

tabsList :: MonadWidget t m => Dynamic t Text -> m a -> m a
tabsList classNameDyn inner = snd <$> tabsList' classNameDyn inner

tabsTrigger' :: MonadWidget t m => Dynamic t Text -> Dynamic t Bool -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tabsTrigger' classNameDyn dataStateDyn inner =
  elDynAttr' "button" (liftA2 (,) classNameDyn dataStateDyn <&> \(cls, ds) ->
           ("class" =: ("inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm " <> cls))
        <> ("data-state" =: bool "inactive" "active" ds)
    ) inner

tabsTrigger :: MonadWidget t m => Dynamic t Text -> Dynamic t Bool -> m a -> m a
tabsTrigger classNameDyn dataStateDyn inner = snd <$> tabsTrigger' classNameDyn dataStateDyn inner

tabsContent' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tabsContent' classNameDyn inner =
  elDynClass' "div" (("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " <>) <$> classNameDyn)
    inner

tabsContent :: MonadWidget t m => Dynamic t Text -> m a -> m a
tabsContent classNameDyn inner = snd <$> tabsContent' classNameDyn inner
