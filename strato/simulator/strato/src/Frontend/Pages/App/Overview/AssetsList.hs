{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Pages.App.Overview.AssetsList where

import Common.Route
import Control.Lens
import Data.Bool (bool)
import Data.Default
import Data.Foldable (for_)
import Data.Text (Text)
import qualified Data.Text as T
import Frontend.Components.Button
import Frontend.Components.SVG.ChevronDown
import Frontend.Components.SVG.ChevronUp
import Frontend.Components.SVG.Plus
import Frontend.Utils (whenDyn)
import Reflex.Dom hiding (button)

data Token = Token
  { _name :: Text
  , _symbol :: Text
  , _images :: [Text]
  , _price :: Maybe Double
  , _balance :: Double
  , _collateralBalance :: Double
  , _change :: Maybe Double
  } deriving (Eq, Ord)

makeLenses ''Token

data AssetsListProps = AssetsListProps
  { _alp_loading            :: Bool
  , _alp_tokens             :: [Token]
  , _alp_isDashboard        :: Bool
  , _alp_inactiveTokens     :: [Token]
  , _alp_shouldPreventFlash :: Bool
  } deriving (Eq, Ord)

instance Default AssetsListProps where
  def = AssetsListProps False [] True [] True

makeLenses ''AssetsListProps

assetsList :: MonadWidget t m => Dynamic t AssetsListProps -> m ()
assetsList propsDyn = mdo
  showNEAT <- toggle False setShowNEAT
  setShowNEAT <- elClass "div" "bg-white rounded-xl border border-gray-100 shadow-sm w-full overflow-hidden" $ do
    elClass "div" "p-5 border-b border-gray-100" $
      elClass "div" "flex justify-between items-center" $ do
        elClass "h2" "font-bold text-lg" $
          text "My Deposits"
        whenDyn (_alp_isDashboard <$> propsDyn) $ do
          button (constDyn $ def & bpSize .~ BSSmall) $ do
            plus $ def & svg_size .~ 16
            elAttr "a" (
                   "class" =: "text-sm text-white flex items-center justify-end"
                <> "href" =: (serializeRoute . RouteApp $ AppDashboard AppDeposits)
              ) $ text "Add Deposits"
    el "div" $ do
      elClass "div" "p-4 text-right border-t border-gray-100 flex justify-between" $
        elClass "span" "font-bold" $
          text "Earning Assets"
      elAttr "div" (
             "class" =: "w-full overflow-x-auto"
          <> "style" =: "-webkit-overflow-scrolling: touch"
        ) $ do
        elAttr "table" ("style" =: "min-width: 700px; width: 100%;") $ do
          el "thead" $
            elClass "tr" "bg-gray-50" $ do
              elClass "th" "text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[140px]" $
                text "Asset"
              elClass "th" "text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[80px]" $
                text "Price"
              elClass "th" "text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[80px]" $
                text "Change"
              elClass "th" "text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]" $
                text "Balance"
              elClass "th" "text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]" $
                text "Collateral Balance"
              elClass "th" "text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]" $
                text "Value"
          elClass "tbody" "divide-y divide-gray-100" . dyn_ . ffor propsDyn $ \props -> do
            if props ^. alp_loading && props ^. alp_shouldPreventFlash
              then elClass "tr" "hover:bg-gray-50 divide-gray-100" $
                elAttr "td" ("colspan" =: "6" <> "class" =: "py-4 px-4 whitespace-nowrap w-full") $
                  elClass "div" "w-full flex justify-center items-center h-16" $
                    elClass "div" "animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" blank
              else if null $ props ^. alp_tokens
                then elClass "tr" "hover:bg-gray-50 transition-colors" $
                  elAttr "td" ("colspan" =: "6" <> "class" =: "py-4 px-4 whitespace-nowrap w-full") $
                    elClass "div" "w-full flex justify-center items-center h-16" $
                      el "div" $ text "No data to show"
                else for_ (zip [(0 :: Int)..] $ props ^. alp_tokens) $ \(i, asset) -> do
                  elAttr "tr" ("key" =: T.pack (show i) <> "class" =: "hover:bg-gray-50 transition-colors") $ do
                    elClass "td" "py-4 px-4" $
                      elClass "div" "flex items-center" $ do
                        case asset ^. images of
                          (img:_) -> elAttr "img" (
                                 "src" =: img
                              <> "alt" =: asset ^. name
                              <> "class" =: "w-8 h-8 rounded-full object-cover"
                            ) blank
                          [] -> elAttr "div" (
                                 "class" =: "w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                              <> "style" =: "background-color: red;"
                            ) . text $ if T.length (asset ^. symbol) < 2
                                         then "??" 
                                         else T.take 2 $ asset ^. symbol
                        elClass "div" "ml-3 min-w-0 flex-1" $ do
                          elClass "div" "font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors" $
                            text $ asset ^. name
                          elClass "p" "text-gray-500 text-xs truncate" $
                            text $ asset ^. symbol
                          --  <TooltipProvider>
                          --    <Tooltip>
                          --      <TooltipTrigger asChild>
                          --        <Link
                          --          to={`/dashboard/deposits/${asset?.token?.address || ''}`}
                          --          className="font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors"
                          --        >
                          --          {asset?.token?._name || ""}
                          --        </Link>
                          --      </TooltipTrigger>
                          --      <TooltipContent>
                          --        <p>{asset?.token?._name || ""}</p>
                          --      </TooltipContent>
                          --    </Tooltip>
                          --  </TooltipProvider>
                          --  <TooltipProvider>
                          --    <Tooltip>
                          --      <TooltipTrigger asChild>
                          --        <p className="text-gray-500 text-xs truncate">
                          --          {asset?.token?._symbol || ""}
                          --        </p>
                          --      </TooltipTrigger>
                          --      <TooltipContent>
                          --        <p>{asset?.token?._symbol || ""}</p>
                          --      </TooltipContent>
                          --    </Tooltip>
                          --  </TooltipProvider>
                    elClass "td" "py-4 px-4 whitespace-nowrap text-right" $
                      elClass "p" "font-medium text-gray-900" $
                        if asset ^. price >= Just 0
                          then text . T.pack . show $ asset ^. balance
                          else text "-"
                               -- formatBalance(asset.price, undefined, 18, 2, 2, true)}
                    elClass "td" "py-4 px-4 whitespace-nowrap text-right" $
                      elClass "div" ("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " <>
                        (if asset ^. change >= Just 0
                           then "bg-green-50 text-green-600"
                           else "bg-red-50 text-red-600")) $
                          text $ case asset ^. change of
                            Just c -> (bool "" "+" $ c >= 0) <> T.pack (show c)
                            Nothing -> "-"
                    elClass "td" "py-4 px-4 whitespace-nowrap text-right" $
                      elClass "p" "font-medium text-gray-900" $
                        if asset ^. balance == 0
                          then text "-"
                          else text . T.pack . show $ asset ^. balance
                               -- formatBalance(asset.balance, undefined, 18,1, 4)}
                    elClass "td" "py-4 px-4 whitespace-nowrap text-right" $
                      elClass "p" "font-medium text-gray-900" $
                        if asset ^. collateralBalance > 0
                          then text . T.pack . show $ asset ^. collateralBalance
                               -- formatBalance(asset.collateralBalance, undefined, 18,1,4)}
                          else text "-"
                    elClass "td" "py-4 px-4 whitespace-nowrap text-right" $
                      elClass "p" "font-medium text-gray-900" $ case asset ^. price of
                        Nothing -> text "-"
                        Just p -> if p == 0 || (asset ^. balance == 0 && asset ^. collateralBalance == 0)
                          then text "-"
                          else text . T.pack . show $ p * (asset ^. balance + asset ^. collateralBalance)
    (switchHold never =<<) . dyn . ffor (liftA2 (,) showNEAT propsDyn) $ \case
      (_, props) | not (props ^. alp_isDashboard) -> pure never
      (showNEAT', props) -> el "div" $ do
        setShowNEAT' <- elClass "div" "p-4 text-right border-t border-gray-100 flex justify-between" $ do
          elClass "span" "font-bold" $
            text "Non-earning Assets"
          elClass "div" "flex gap-4" $ do
            (e, _) <- button' (constDyn $ def & bpSize .~ BSSmall) $
              elClass "div" "flex gap-1 justify-center items-center" $             
                if showNEAT'
                  then chevronUp $ def & svg_size .~ 20
                  else chevronDown $ def & svg_size .~ 20
            pure $ domEvent Click e
        elClass "div" ("transition-all duration-300 ease-in-out overflow-hidden "
          <> (bool "max-h-0 opacity-0" "max-h-[400px] opacity-100" showNEAT')) $
          elClass "div" "overflow-y-auto max-h-[400px]" $
            elClass "table" "w-full table-fixed" $ do
              el "thead" $
                elClass "tr" "bg-gray-50" $ do
                  elClass "th" "w-[50%] text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4" $
                    text "Asset"
                  elClass "th" "w-[50%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4" $
                    text "Balance"
              elClass "tbody" "divide-y divide-gray-100" $ if props ^. alp_loading && props ^. alp_shouldPreventFlash
                then elClass "tr" "hover:bg-gray-50 transition-colors" $
                  elAttr "td" ("colspan" =: "5" <> "class" =: "py-4 px-4 whitespace-nowrap w-full") $
                    elClass "div" "w-full flex justify-center items-center h-16" $
                      elClass "div" "animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" blank
                else if null $ props ^. alp_inactiveTokens
                  then elClass "tr" "hover:bg-gray-50 transition-colors" $
                    elAttr "td" ("colspan" =: "5" <> "class" =: "py-4 px-4 whitespace-nowrap w-full") $
                      elClass "div" "w-full flex justify-center items-center h-16" $
                        el "div" $ text "No data to show"
                  else for_ (zip [(0 :: Int)..] $ props ^. alp_inactiveTokens) $ \(i, asset) -> do
                    elAttr "tr" ("key" =: (T.pack $ show i) <> "class" =: "hover:bg-gray-50 transition-colors") $ do
                      elClass "td" "py-4 px-4" $
                        elClass "div" "flex items-center" $ do
                          case asset ^. images of
                            (img:_) -> elAttr "img" (
                                   "src" =: img
                                <> "alt" =: asset ^. name
                                <> "class" =: "w-8 h-8 rounded-full object-cover"
                              ) blank
                            [] -> elAttr "div" (
                                   "class" =: "w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                                <> "style" =: "background-color: red;"
                              ) . text $ if T.length (asset ^. symbol) < 2
                                           then "??" 
                                           else T.take 2 $ asset ^. symbol
                          elClass "div" "ml-3 min-w-0 flex-1" $ do
                            elClass "div" "font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors" $
                              text $ asset ^. name
                            elClass "p" "text-gray-500 text-xs truncate" $
                              text $ asset ^. symbol
                      elClass "td" "py-4 px-4 whitespace-nowrap text-right" $
                        elClass "p" "font-medium text-gray-900" $
                          if asset ^. balance == 0
                            then text "-"
                            else text . T.pack . show $ asset ^. balance
                                 -- formatBalance(asset.balance, undefined, 18,1, 4)}
        pure setShowNEAT'
  pure ()