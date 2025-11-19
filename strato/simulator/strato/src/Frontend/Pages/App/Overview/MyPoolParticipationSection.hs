{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Pages.App.Overview.MyPoolParticipationSection where

import Control.Applicative ((<|>))
import Control.Lens
import Data.Default
import Data.Text (Text)
import qualified Data.Text as T
import Frontend.Components.Card
import Frontend.Utils
import Reflex.Dom
import Text.Printf

data WithdrawableValue = WithdrawableValue
  { _name          :: Text
  , _userBalance   :: Double
  , _withdrawValue :: Double
  } deriving (Eq, Ord)

instance Default WithdrawableValue where
  def = WithdrawableValue "" 0.0 0.0

makeLenses ''WithdrawableValue

data LiquidityInfo = LiquidityInfo
  { _withdrawable :: WithdrawableValue
  , _supplyAPY    :: Double
  } deriving (Eq, Ord)

instance Default LiquidityInfo where
  def = LiquidityInfo def 0.0

makeLenses ''LiquidityInfo

data Pool = Pool deriving (Eq, Ord)

data SafetyInfo = SafetyInfo
  { _userShares   :: Double
  , _exchangeRate :: Double
  } deriving (Eq, Ord)

instance Default SafetyInfo where
  def = SafetyInfo 0.0 0.0

makeLenses ''SafetyInfo

data PoolParticipationProps = PoolParticipationProps
  { _ppp_liquidityInfo      :: Maybe LiquidityInfo
  , _ppp_userPools          :: Maybe [Pool]
  , _ppp_safetyInfo         :: Maybe SafetyInfo
  , _ppp_shouldPreventFlash :: Bool
  } deriving (Eq, Ord)

instance Default PoolParticipationProps where
  def = PoolParticipationProps Nothing Nothing Nothing False

makeLenses ''PoolParticipationProps

myPoolParticipationSection :: MonadWidget t m => Dynamic t PoolParticipationProps -> m ()
myPoolParticipationSection = withDyn_ $ \props -> card (constDyn "rounded-2xl shadow-sm w-full mb-6") $ do
  let shouldShowLoading = maybe (not $ props ^. ppp_shouldPreventFlash) (const False) $
            (() <$ props ^. ppp_liquidityInfo)
        <|> (() <$ props ^. ppp_userPools)
        <|> (() <$ props ^. ppp_safetyInfo)
  cardHeader (constDyn "") $
    cardTitle (constDyn "text-lg font-semibold text-gray-800") $
      text "My Pool Participation"
  cardContent (constDyn "space-y-4") $ do
    elClass "div" "grid grid-cols-4 px-4 text-sm text-gray-500 font-medium" $ do
      el "div" $ text "Token"
      elClass "div" "text-center" $ text "Balance"
      elClass "div" "text-center" $ text "APY"
      elClass "div" "text-right"  $ text "Value"
    if shouldShowLoading
      then elClass "div" "flex items-center justify-center gap-2" $ do
        elClass "div" "animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" blank
        elClass "span" "text-sm text-gray-600" $
          text "Loading..."
      else do
        case _withdrawable <$> props ^. ppp_liquidityInfo of
          Nothing -> blank
          Just w -> elClass "div" "grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2" $ do
            elClass "div" "font-semibold text-gray-700" $
              text $ w ^. name
            elClass "div" "text-center font-semibold text-gray-900" $
              text . T.pack . printf "%.02f" $ w ^. userBalance
            elClass "div" "text-center font-semibold text-gray-900" $
              case _supplyAPY <$> props ^. ppp_liquidityInfo of
                Nothing -> text "N/A"
                Just apy -> text . T.pack $ show apy <> "%"
            elClass "div" "text-right font-medium text-gray-900" $
              text . T.pack . printf "%.02f" $ w ^. withdrawValue
        case props ^. ppp_safetyInfo of 
          Just si | si ^. userShares > 0.0 ->
            elClass "div" "grid grid-cols-4 items-center bg-gray-50 px-4 py-3 rounded-md mb-2" $ do
              elClass "div" "font-semibold text-gray-700" $
                text "sUSDST"
              elClass "div" "text-center font-semibold text-gray-900" $
                text . T.pack . printf "%.02f" $ si ^. userShares
              elClass "div" "text-center font-semibold text-gray-900" $
                text . T.pack . printf "%.02f" $ (si ^. exchangeRate) - 1.0
              elClass "div" "text-right font-medium text-gray-900" $
                text . T.pack . printf "%.02f" $ (si ^. userShares) * (si ^. exchangeRate)
          _ -> blank