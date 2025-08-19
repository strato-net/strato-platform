{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Components.Card where

import Data.Text (Text)
import Reflex.Dom

card' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
card' classNameDyn inner =
  elDynClass' "div" (("rounded-lg border bg-card text-card-foreground shadow-sm " <>) <$> classNameDyn)
    inner

card :: MonadWidget t m => Dynamic t Text -> m a -> m a
card classNameDyn inner = snd <$> card' classNameDyn inner

cardHeader' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
cardHeader' classNameDyn inner =
  elDynClass' "div" (("flex flex-col space-y-1.5 p-6 " <>) <$> classNameDyn)
    inner

cardHeader :: MonadWidget t m => Dynamic t Text -> m a -> m a
cardHeader classNameDyn inner = snd <$> cardHeader' classNameDyn inner

cardTitle' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
cardTitle' classNameDyn inner =
  elDynClass' "h3" (("text-2xl font-semibold leading-none tracking-tight " <>) <$> classNameDyn)
    inner

cardTitle :: MonadWidget t m => Dynamic t Text -> m a -> m a
cardTitle classNameDyn inner = snd <$> cardTitle' classNameDyn inner

cardDescription' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
cardDescription' classNameDyn inner =
  elDynClass' "div" (("text-sm text-muted-foreground " <>) <$> classNameDyn)
    inner

cardDescription :: MonadWidget t m => Dynamic t Text -> m a -> m a
cardDescription classNameDyn inner = snd <$> cardDescription' classNameDyn inner

cardContent' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
cardContent' classNameDyn inner =
  elDynClass' "div" (("p-6 pt-0 " <>) <$> classNameDyn)
    inner

cardContent :: MonadWidget t m => Dynamic t Text -> m a -> m a
cardContent classNameDyn inner = snd <$> cardContent' classNameDyn inner

cardFooter' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
cardFooter' classNameDyn inner =
  elDynClass' "div" (("flex items-center p-6 pt-0 " <>) <$> classNameDyn)
    inner

cardFooter :: MonadWidget t m => Dynamic t Text -> m a -> m a
cardFooter classNameDyn inner = snd <$> cardFooter' classNameDyn inner
