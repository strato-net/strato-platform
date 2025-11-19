{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Pages.App.Overview.AssetSummary where

import Control.Lens
import Data.Default
import Data.Text (Text)
import Frontend.Utils (withDyn_)
import Reflex.Dom

data AssetSummaryProps m = AssetSummaryProps
  { _as_title   :: Text
  , _as_value   :: Text
  , _as_icon    :: m ()
  , _as_color   :: Text
  , _as_onClick :: Maybe (Performable m ())
  , _as_tooltip :: Maybe Text
  }

makeLenses ''AssetSummaryProps

instance Monad m => Default (AssetSummaryProps m) where
  def = AssetSummaryProps "" "" (pure ()) "" Nothing Nothing

assetSummary :: MonadWidget t m => Dynamic t (AssetSummaryProps m) -> m ()
assetSummary = withDyn_ $ \props -> do
  elClass "div" "bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow" $
    elClass "div" "flex justify-between items-start" $ do
      el "div" $ do
        elClass "div" "flex items-center gap-1" $ do
          elClass "p" "text-gray-500 text-sm" $
            text $ props ^. as_title
          -- for_ (props ^. as_tooltip) $ \tt ->
        elClass "h3" "text-2xl font-bold mt-1" $
          text $ props ^. as_value
      (e, _) <- elClass' "div" (
             "w-10 h-10 rounded-full flex items-center justify-center "
          <> props ^. as_color
          <> " "
          <> (case props ^. as_onClick of
               Just _ -> "cursor-pointer hover:opacity-80 transition-opacity"
               Nothing -> "")
        ) $ props ^. as_icon
      performEvent_ . ffor (domEvent Click e) $ \_ -> case props ^. as_onClick of
        Nothing -> pure ()
        Just onClick -> onClick