{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Pages.App.Header where

import Blockchain.Strato.Model.Address
import Control.Lens
import Data.Default
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import Frontend.Components.Button
import Frontend.Components.CopyButton
import Frontend.Components.Popover
import Frontend.Components.SVG
import Frontend.Components.SVG.Logout
import Frontend.Components.SVG.Menu
import Reflex.Dom hiding (button)

data DashboardHeaderProps = DashboardHeaderProps
  { _dhp_title       :: Text
  , _dhp_username    :: Maybe Text
  , _dhp_userAddress :: Maybe Address
  } deriving (Eq, Ord)

instance Default DashboardHeaderProps where
  def = DashboardHeaderProps "" Nothing Nothing

makeLenses ''DashboardHeaderProps

truncateAddress :: Maybe Int -> Maybe Int -> Maybe Address -> Text
truncateAddress _  _  Nothing    = "N/A"
truncateAddress f' b' (Just a' ) =
  let f = fromMaybe 6 f'
      b = fromMaybe 4 b'
      a = T.pack $ show a'
   in if T.length a <= f + b
        then a
        else (T.take f a) <> "..." <> (T.drop (T.length a - b) a)

getAvatarFallback :: Maybe Text -> Text
getAvatarFallback Nothing  = "NA"
getAvatarFallback (Just n) = T.toUpper $ T.take 2 n

dashboardHeader :: MonadWidget t m => Dynamic t DashboardHeaderProps -> m ()
dashboardHeader props =
  elClass "header" "bg-white border-b border-gray-100 py-4 px-6 flex items-center justify-between" $ do
    elClass "div" "flex items-center" $ do
      elClass "button" "md:hidden mr-4 p-2 hover:bg-gray-100 rounded-md" $
        menu $ def & svg_size .~ 20
      elClass "h1" "text-xl font-bold" $
        dynText $ _dhp_title <$> props
  
    let uName = _dhp_username <$> props
        uAddr = _dhp_userAddress <$> props
    elClass "div" "flex items-center space-x-4" $
      elClass "div" "flex items-center" $ do
        elClass "div" "flex flex-col items-end mr-3" $ do
          elClass "span" "text-sm font-medium" $
            dynText $ fromMaybe "N/A" <$> uName
          elClass "div" "flex items-center" $ do
            elClass "span" "text-xs text-gray-500" $
              dynText $ truncateAddress Nothing Nothing <$> uAddr
            copyButton uAddr
        popover def $ \isOpen -> do
          (e, _) <- avatar "w-8 h-8 bg-strato-blue cursor-pointer" $
            avatarFallback "text-white text-xs bg-strato-blue" $
              dynText $ getAvatarFallback <$> uName
          dyn_ . ffor isOpen $ \case
            False -> blank
            True -> elClass "div" "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-full p-3 shadow-md mt-2" $
              elClass "div" "flex flex-col space-y-0.5" $ do
                elClass "div" "text-sm font-medium" $
                  dynText $ fromMaybe "N/A" <$> uName
                elClass "div" "text-xs text-gray-600 break-all !mb-1" $
                  dynText $ truncateAddress (Just 16) (Just 8) <$> uAddr
                
                button (constDyn $
                    def & bpVariant .~ BVDestructive
                        & bpSize .~ BSSmall
                  ) $ do
                  logoutIcon def
                  text "Logout"
          let toggleOpen = not <$> tag (current isOpen) (domEvent Click e)
          pure (toggleOpen, ())
        where avatar = elClass' "div"
              avatarFallback = elClass "div"
  