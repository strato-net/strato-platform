{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Components.Table where

import Data.Text (Text)
import Reflex.Dom

table' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
table' classNameDyn inner =
  elClass "div" "relative w-full overflow-auto" $
    elDynClass' "table" (("w-full caption-bottom text-sm " <>) <$> classNameDyn)
      inner

table :: MonadWidget t m => Dynamic t Text -> m a -> m a
table classNameDyn inner = snd <$> table' classNameDyn inner

tableHeader' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableHeader' classNameDyn inner =
  elDynClass' "thead" (("[&_tr]:border-b " <>) <$> classNameDyn)
    inner

tableHeader :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableHeader classNameDyn inner = snd <$> tableHeader' classNameDyn inner

tableBody' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableBody' classNameDyn inner =
  elDynClass' "tbody" (("[&_tr:last-child]:border-0 " <>) <$> classNameDyn)
    inner

tableBody :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableBody classNameDyn inner = snd <$> tableBody' classNameDyn inner

tableFooter' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableFooter' classNameDyn inner =
  elDynClass' "tbody" (("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0 " <>) <$> classNameDyn)
    inner

tableFooter :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableFooter classNameDyn inner = snd <$> tableFooter' classNameDyn inner

tableRow' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableRow' classNameDyn inner =
  elDynClass' "tr" (("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted " <>) <$> classNameDyn)
    inner

tableRow :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableRow classNameDyn inner = snd <$> tableRow' classNameDyn inner

tableHead' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableHead' classNameDyn inner =
  elDynClass' "th" (("h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 " <>) <$> classNameDyn)
    inner

tableHead :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableHead classNameDyn inner = snd <$> tableHead' classNameDyn inner

tableCell' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableCell' classNameDyn inner =
  elDynClass' "td" (("p-4 align-middle [&:has([role=checkbox])]:pr-0 " <>) <$> classNameDyn)
    inner

tableCell :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableCell classNameDyn inner = snd <$> tableCell' classNameDyn inner

tableCaption' :: MonadWidget t m => Dynamic t Text -> m a -> m (Element EventResult (DomBuilderSpace m) t, a)
tableCaption' classNameDyn inner =
  elDynClass' "caption" (("mt-4 text-sm text-muted-foreground " <>) <$> classNameDyn)
    inner

tableCaption :: MonadWidget t m => Dynamic t Text -> m a -> m a
tableCaption classNameDyn inner = snd <$> tableCaption' classNameDyn inner