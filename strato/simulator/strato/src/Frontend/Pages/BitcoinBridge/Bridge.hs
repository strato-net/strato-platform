{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Frontend.Pages.BitcoinBridge.Bridge where

import Reflex.Dom hiding (button)
import Common.BridgeClient
import Control.Exception
import Control.Monad.IO.Class
import Control.Monad (void)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Frontend.Components.Button
import Frontend.Components.Card
import Frontend.Components.Input
import Frontend.Components.SVG.ArrowDown
import Frontend.Components.SVG.ArrowRight
import Frontend.Components.SVG.BitcoinLogo
import Frontend.Types.State
import Frontend.Utils
import Text.Read (readMaybe)

currentPriceOfBitcoin :: Double
currentPriceOfBitcoin = 93217.85 -- 4/23/25 11:28PM EDT

bridgeTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
bridgeTabWidget _ = mdo
  postBuild <- getPostBuild
  btcBalanceEv <- backendGET fetchWalletBalance $ leftmost [postBuild, () <$ bridgeInEv, () <$ bridgeOutEv]
  multisigEv   <- backendGET fetchBridgeState btcBalanceEv
  btcBalanceDyn <- holdDyn 0.0 btcBalanceEv
  multisigDyn   <- holdDyn 0.0 multisigEv
  myBTCSTDyn    <- holdDyn 0.0 multisigEv

  let roundToCents :: Double -> Double
      roundToCents = (/100) . fromInteger . round . (*100)

  (bridgeInEv, bridgeOutEv) <- elClass "div" "container mx-auto py-8 px-4 max-w-6xl" $ do
    elClass "div" "grid grid-cols-1 md:grid-cols-3 gap-6 mb-10" $ do
      card (constDyn "bg-gradient-to-br from-amber-50 to-amber-100 shadow-md border-amber-200") $ do
        cardHeader (constDyn "pb-2") $ do
          cardTitle (constDyn "text-lg flex items-center gap-2") $ do
            bitcoinLogo $ def & svg_class .~ "h-5 w-5 text-amber-500"
            el "span" $ text "BTC Wallet Balance"
          cardDescription (constDyn "") $ do
            text "Your Bitcoin holdings"
        cardContent (constDyn "") $ do
          elClass "div" "text-3xl font-bold text-amber-800" $ do
            dynText $ ((<> " BTC") . T.pack . show) <$> btcBalanceDyn
          elClass "div" "text-sm text-gray-600 mt-1" $ do
            dynText $ ((<> " USD") . ("$" <>) . T.pack . show . roundToCents . (* currentPriceOfBitcoin)) <$> btcBalanceDyn
      card (constDyn "bg-gradient-to-br from-blue-50 to-blue-100 shadow-md border-blue-200") $ do
        cardHeader (constDyn "pb-2") $ do
          cardTitle (constDyn "text-lg flex items-center gap-2") $ do
            arrowRight $ def & svg_class .~ "h-5 w-5 text-blue-500"
            el "span" $ text "Total BTC Bridged"
          cardDescription (constDyn "") $ do
            text "To Mercata"
        cardContent (constDyn "") $ do
          elClass "div" "text-3xl font-bold text-blue-800" $ do
            dynText $ ((<> " BTC") . T.pack . show) <$> multisigDyn
          elClass "div" "text-sm text-gray-600 mt-1" $ do
            dynText $ ((<> " USD") . ("$" <>) . T.pack . show . roundToCents . (* currentPriceOfBitcoin)) <$> multisigDyn
      card (constDyn "bg-gradient-to-br from-purple-50 to-purple-100 shadow-md border-purple-200") $ do
        cardHeader (constDyn "pb-2") $ do
          cardTitle (constDyn "text-lg flex items-center gap-2") $ do
            arrowRight $ def & svg_class .~ "h-5 w-5 text-purple-500"
            el "span" $ text "BTCST Balance"
          cardDescription (constDyn "") $ do
            text "On Mercata"
        cardContent (constDyn "") $ do
          elClass "div" "text-3xl font-bold text-purple-800" $ do
            dynText $ ((<> " BTC") . T.pack . show) <$> myBTCSTDyn
          elClass "div" "text-sm text-gray-600 mt-1" $
            dynText $ ((<> " USD") . ("$" <>) . T.pack . show . roundToCents . (* currentPriceOfBitcoin)) <$> myBTCSTDyn
    elClass "div" "grid grid-cols-1 lg:grid-cols-2 gap-8" $ do
      bridgeInEv' <- card (constDyn "shadow-lg border-blue-200") $ mdo
        cardHeader (constDyn "bg-gradient-to-r from-blue-500 to-blue-600 text-white") $ do
          cardTitle (constDyn "") $ do
            text "Bridge Bitcoin to Mercata"
          cardDescription (constDyn "text-blue-100") $ do
            text "Convert BTC to BTCST on Mercata"
        bridgeInAmt <- cardContent (constDyn "pt-6") $ do
          elClass "div" "space-y-4" $ do
            inputEl <- el "div" $ mdo
              elClass "label" "block text-sm font-medium text-gray-700 mb-1" $ do
                text "Amount to Bridge (BTC)"
              inputEl' <- elClass "div" "relative" $ do
                let attrs = mapKeysToAttributeName $ M.fromList [("type", "number"), ("placeholder", "0.00"), ("class","pr-16")]
                inputEl'' <- input $ def
                  & inputElementConfig_initialValue .~ ""
                  & inputElementConfig_setValue .~ maxBalEv
                  & inputElementConfig_elementConfig . elementConfig_initialAttributes .~ attrs
                elClass "div" "absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none" $ do
                  elClass "span" "text-gray-500" $ do
                    text "BTC"
                pure inputEl''
              (e,_) <- elClass "div" "flex justify-between mt-1 text-xs text-gray-500" $ do
                el "span" $ text "Min: 0.0001 BTC"
                elClass' "button" "text-blue-600" $ text "MAX"
              let maxEv = domEvent Click e
                  maxBalEv = tag (T.pack . show <$> current btcBalanceDyn) maxEv
              pure inputEl'
            elClass "div" "flex items-center gap-2" $ do
              elClass "hr" "flex-1" $ blank
              elClass "div" "bg-blue-100 p-2 rounded-full" $ do
                arrowDown $ def & svg_class .~ "h-4 w-4 text-blue-600"
              elClass "hr" "flex-1" $ blank
            el "div" $ do
              elClass "label" "block text-sm font-medium text-gray-700 mb-1" $ do
                text "You Will Receive (BTCST)"
              elClass "div" "relative" $ do
                void . input' (constDyn $ M.fromList [("type", "number"), ("placeholder", "0.00"), ("disabled", ""), ("class","pr-16 bg-gray-50")]) $ do
                  dynText $ _inputElement_value inputEl
                elClass "div" "absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none" $ do
                  elClass "span" "text-gray-500" $ do
                    text "BTCST"
            elClass "div" "bg-blue-50 p-3 rounded-md text-sm" $ do
              elClass "div" "flex justify-between mb-1" $ do
                elClass "span" "text-gray-600" $ do
                  text "Bridge Fee:"
                elClass "span" "font-medium" $ do
                  text "0.0001 BTC"
              elClass "div" "flex justify-between" $ do
                elClass "span" "text-gray-600" $ do
                  text "Estimated Time:"
                elClass "span" "font-medium" $ do
                  text "~20 minutes"
            pure inputEl
        buttonColorDyn <- holdDyn "blue" $ leftmost ["blue" <$ updated (_inputElement_value bridgeInAmt), "gray" <$ payloadEv, either (const "red") (const "green") <$> resultEv]
        bridgeInEv' <- cardFooter (constDyn "bg-slate-50") $ do
          (e, _) <- button' ((\c -> def { _bpClassName = "w-full bg-" <> c <> "-600 hover:bg-blue-700" }) <$> buttonColorDyn) $ do
            text "Bridge In Bitcoin"
          pure $ domEvent Click e
        let payloadEv = tagPromptlyDyn ((,) <$> pure "bridgeIn" <*> (_inputElement_value bridgeInAmt)) bridgeInEv'
        resultEv <- performEventAsync $ ffor payloadEv $ \(addrTxt, amtTxt) cb -> liftIO $ do
          let parsedAmt = readMaybe (T.unpack amtTxt) :: Maybe Double
          case parsedAmt of
            Just amt -> do
              res <- try @SomeException $ sendToMultisig addrTxt amt
              cb $ either (Left . show) Right res
            Nothing -> cb $ Left "Invalid amount"
  
        -- Display result
        -- dyn_ =<< holdDyn (text "") (ffor resultEv $ \case
        --   Left err -> elClass "div" "tx-error" $ text $ "Error: " <> T.pack err
        --   Right txid -> elClass "div" "tx-success" $ text $ "Sent! TXID: " <> txid)
    
        pure resultEv
      bridgeOutEv' <- card (constDyn "shadow-lg border-purple-200") $ mdo
        cardHeader (constDyn "bg-gradient-to-r from-purple-500 to-purple-600 text-white") $ do
          cardTitle (constDyn "") $ do
            text "Bridge BTCST to Bitcoin"
          cardDescription (constDyn "text-purple-100") $ do
            text "Convert BTCST back to BTC on Bitcoin blockchain"
        bridgeOutAmt <- cardContent (constDyn "pt-6") $ do
          elClass "div" "space-y-4" $ do
            inputEl <- el "div" $ mdo
              elClass "label" "block text-sm font-medium text-gray-700 mb-1" $ do
                text "Amount to Bridge (BTCST)"
              inputEl' <- elClass "div" "relative" $ do
                let attrs = mapKeysToAttributeName $ M.fromList [("type", "number"), ("placeholder", "0.00"), ("class","pr-16")]
                inputEl'' <- input $ def
                  & inputElementConfig_initialValue .~ ""
                  & inputElementConfig_setValue .~ maxBalEv
                  & inputElementConfig_elementConfig . elementConfig_initialAttributes .~ attrs
                elClass "div" "absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none" $ do
                  elClass "span" "text-gray-500" $ do
                    text "BTCST"
                pure inputEl''
              (e,_) <- elClass "div" "flex justify-between mt-1 text-xs text-gray-500" $ do
                el "span" $ text "Min: 0.0001 BTC"
                elClass' "button" "text-purple-600" $ text "MAX"
              let maxEv = domEvent Click e
                  maxBalEv = tag (T.pack . show <$> current btcBalanceDyn) maxEv
              pure inputEl'
            elClass "div" "flex items-center gap-2" $ do
              elClass "hr" "flex-1" $ blank
              elClass "div" "bg-purple-100 p-2 rounded-full" $ do
                arrowDown $ def & svg_class .~ "h-4 w-4 text-purple-600"
              elClass "hr" "flex-1" $ blank
            el "div" $ do
              elClass "label" "block text-sm font-medium text-gray-700 mb-1" $ do
                text "You Will Receive (BTC)"
              elClass "div" "relative" $ do
                void . input' (constDyn $ M.fromList [("type", "number"), ("placeholder", "0.00"), ("disabled", ""), ("class","pr-16 bg-gray-50")]) $ do
                  dynText $ _inputElement_value inputEl
                elClass "div" "absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none" $ do
                  elClass "span" "text-gray-500" $ do
                    text "BTC"
            elClass "div" "bg-purple-50 p-3 rounded-md text-sm" $ do
              elClass "div" "flex justify-between mb-1" $ do
                elClass "span" "text-gray-600" $ do
                  text "Bridge Fee:"
                elClass "span" "font-medium" $ do
                  text "0.0001 BTC"
              elClass "div" "flex justify-between" $ do
                elClass "span" "text-gray-600" $ do
                  text "Estimated Time:"
                elClass "span" "font-medium" $ do
                  text "~30 minutes"
            pure inputEl
        buttonColorDyn <- holdDyn "purple" $ leftmost ["purple" <$ updated (_inputElement_value bridgeOutAmt), "gray" <$ payloadEv, either (const "red") (const "green") <$> resultEv]
        bridgeOutEv' <- cardFooter (constDyn "bg-slate-50") $ do
          (e, _) <- button' ((\c -> def { _bpClassName = "w-full bg-" <> c <> "-600 hover:bg-blue-700" }) <$> buttonColorDyn) $ do
            text "Bridge Out BTCST"
          pure $ domEvent Click e
        let payloadEv = tag (current $ (,) <$> pure "bridgeOut" <*> (_inputElement_value bridgeOutAmt)) bridgeOutEv'
        resultEv <- performEventAsync $ ffor payloadEv $ \(addrTxt, amtTxt) cb -> liftIO $ do
          let parsedAmt = readMaybe (T.unpack amtTxt) :: Maybe Double
          case parsedAmt of
            Just amt -> do
              res <- try @SomeException $ sendToMultisig addrTxt amt
              cb $ either (Left . show) Right res
            Nothing -> cb $ Left "Invalid amount"
  
        -- Display result
        -- dyn_ =<< holdDyn (text "") (ffor resultEv $ \case
        --   Left err -> elClass "div" "tx-error" $ text $ "Error: " <> T.pack err
        --   Right txid -> elClass "div" "tx-success" $ text $ "Sent! TXID: " <> txid)
    
        pure resultEv
      pure (bridgeInEv', bridgeOutEv')
  pure ()