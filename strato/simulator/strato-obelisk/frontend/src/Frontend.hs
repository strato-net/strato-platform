{-# LANGUAGE DataKinds #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Frontend where

import Control.Lens
import Control.Monad
import qualified Data.Aeson as Aeson
import Data.ByteString.Lazy (fromStrict, toStrict)
import Data.Foldable (for_)
import Data.List.NonEmpty (nonEmpty)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes)
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Float (double2Float)
import GHCJS.DOM.Element
import GHCJS.DOM.HTMLCanvasElement
import GHCJS.DOM.Types (uncheckedCastTo)
import Language.Javascript.JSaddle
import Numeric (showHex)

import Obelisk.Configs
import Obelisk.Frontend
import Obelisk.Route

import Reflex
import Reflex.Dom
import qualified Reflex.Dom.Canvas.Context2D as CanvasF
import qualified Reflex.Dom.CanvasBuilder.Types as Canvas
import qualified Reflex.Dom.CanvasDyn as Canvas
import Text.URI

import Common.Message
import Common.Route

frontend :: Frontend (R FrontendRoute)
frontend = Frontend
  { _frontend_head = do
      el "title" $ text "STRATO-Lite Dashboard"
      elAttr "link" ("href" =: "static/main.css" <> "type" =: "text/css" <> "rel" =: "stylesheet") blank
  , _frontend_body = do
    route <- getTextConfig "common/route"
    prerender_ blank $ app route
  }

app
  :: MonadWidget t m
  => Maybe Text
  -> m ()
app route = do
  rec
    _ <- networkWidget nodesDyn
    let 
      nodesEv = fmapMaybe isNodesEv msgRecEv
    nodesDyn <- holdDyn M.empty nodesEv
    msgRecEv <- wsEv route never
  blank
  where
    isNodesEv = \case
      (S2CNodes nodes') -> Just nodes'
      _ -> Nothing

networkWidget
  :: MonadWidget t m
  => Dynamic t (M.Map Text Node)
  -> m ()
networkWidget nodesDyn = do
  pbE <- getPostBuild
  rec
    let canvasW = 1200 :: Int
        canvasW2 = fromIntegral canvasW / 2
        canvasH = 640 :: Int
        canvasH2 = fromIntegral canvasH / 2
        canvasAttrs = M.fromList
          [ ("height" :: Text, T.pack (show canvasH))
          , ("width" , T.pack (show canvasW))
          -- , ("style", "border:1px solid black")
          ]
        twoPi = 2.0*pi

    -- Create the canvas element, using the backticked el function so Reflex.Dom provides us
    -- with the `El t`, which is the representation of the <canvas> element.
    _ <- elClass "div" "myCanvas" $ do
      (canvasEl, _ ) <- elAttr' "canvas" (canvasAttrs <> ("style" =: "border:1px solid black")) blank
      (bufferCanvas, _ ) <- elAttr' "canvas" (canvasAttrs <> ("style" =: "display: none")) blank
      let bufferElement = _element_raw bufferCanvas
      on2DDyn <- fmap (^. Canvas.canvasInfo_context) <$> Canvas.dContext2d ( Canvas.CanvasConfig canvasEl [] )
      off2DDyn <- fmap (^. Canvas.canvasInfo_context) <$> Canvas.dContext2d ( Canvas.CanvasConfig bufferCanvas [] )
      let initAction (on2D, (off2D, ((c_x, c_y), nodesMap'))) = do
            let nodesMap = M.fromList . map (\((ip,n),i) -> (ip,(n,i))) $ zip (M.toList nodesMap') [0..]
                nodes' = M.elems nodesMap'
                connsFor n x = (\(m,y) -> (x,fromIntegral . length $ _nodeConns n, y, fromIntegral . length $ _nodeConns m)) <$> catMaybes ((\a -> M.lookup a nodesMap) <$> _nodeConns n)
                conns = concatMap (uncurry connsFor) $ M.elems nodesMap
            let plot ns cs = do
                  CanvasF.fillStyleF (textToJSString "#ffffff")
                  CanvasF.fillRectF 0.0 0.0 (fromIntegral canvasW) (fromIntegral canvasH)
                  let len = fromIntegral $ length ns
                      -- currentSel = floor . (* len) <$> currentSel'
                      r = 25.0 -- min 50.0 (canvasH2 / len)
                  for_ cs $ \(a,na,b,nb) -> do
                    let a_x = canvasW2 + (((canvasW2 * 0.95 * (len - na)) / (len)) * (cos (twoPi * (a / len))))
                        a_y = canvasH2 + (((canvasH2 * 0.95 * (len - na)) / (len)) * (sin (twoPi * (a / len))))
                        b_x = canvasW2 + (((canvasW2 * 0.95 * (len - nb)) / (len)) * (cos (twoPi * (b / len))))
                        b_y = canvasH2 + (((canvasH2 * 0.95 * (len - nb)) / (len)) * (sin (twoPi * (b / len))))
                    if a < b
                      then do
                        CanvasF.beginPathF
                        if (fromIntegral c_x >= a_x - r && fromIntegral c_x <= a_x + r && fromIntegral c_y >= a_y - r && fromIntegral c_y <= a_y + r)
                           || (fromIntegral c_x >= b_x - r && fromIntegral c_x <= b_x + r && fromIntegral c_y >= b_y - r && fromIntegral c_y <= b_y + r)
                          then CanvasF.strokeStyleF (textToJSString "#000000")
                          else CanvasF.strokeStyleF (textToJSString "#cccccc")
                        -- CanvasF.lineWidthF 5.0
                        CanvasF.moveToF a_x a_y
                        CanvasF.lineToF b_x b_y
                        CanvasF.strokeF
                        CanvasF.closePathF
                      else pure ()
                  ifor_ ns $ \i n -> do
                    let cLen = fromIntegral . length $ _nodeConns n
                        x = canvasW2 + (((canvasW2 * 0.95 * (len - cLen)) / (len)) * (cos (twoPi * (fromIntegral i / len))))
                        y = canvasH2 + (((canvasH2 * 0.95 * (len - cLen)) / (len)) * (sin (twoPi * (fromIntegral i / len))))
                        colorHash = case _nodeStatus n of
                          Nothing -> "ffffff"
                          Just (NodeStatus _ _ rn sn) ->
                            let sr  = sn * rn
                                srr = (sr * 31) `mod` 256
                                srg = (sr * 47) `mod` 256
                                srb = (sr * 59) `mod` 256
                                spr = ((srr * 256 * 256) + (srg * 256) + srb) `mod` 0x1000000
                                h = showHex spr ""
                             in T.pack $ replicate (6 - length h) '0' ++ h
                    CanvasF.beginPathF
                    CanvasF.arcF x y r 0 twoPi True
                    CanvasF.fillStyleF (textToJSString $ "#" <> colorHash)
                    CanvasF.fillF
                    CanvasF.setLineWidthF 2.0
                    CanvasF.strokeStyleF (textToJSString "#000000")
                    case _isValidator <$> _nodeStatus n of
                      Just True -> CanvasF.strokeStyleF (textToJSString "#00ff00")
                      _ -> CanvasF.strokeStyleF (textToJSString "#000000")
                    CanvasF.strokeF
                    CanvasF.closePathF
                    CanvasF.setLineWidthF 1.0
                    CanvasF.beginPathF
                    CanvasF.fillStyleF (textToJSString "#000000")
                    CanvasF.strokeStyleF (textToJSString "#000000")
                    CanvasF.fillTextF (_nodeName n) (double2Float $ x - r + 5) (double2Float $ y + 2.5) (Just 100.0)
                    CanvasF.strokeF
                    CanvasF.closePathF

            void . liftJSM $ CanvasF.drawToCanvas (plot nodes' conns) off2D
            void . liftJSM $ CanvasF.drawToCanvas (CanvasF.drawImageF (uncheckedCastTo HTMLCanvasElement bufferElement) 0.0 0.0) on2D
      currentSelection <- holdDyn (0,0) (domEvent Mousedown canvasEl)
      let events = leftmost [() <$ updated currentSelection, () <$ updated nodesDyn, () <$ pbE]
      performEvent_ (ffor (attach (current on2DDyn) . attach (current off2DDyn)
                  . attachWith (\a (b,_) -> (a,b)) (current currentSelection)
                  . attach (current nodesDyn) $ events) initAction)
  pure ()

wsEv :: MonadWidget t m => Maybe Text -> Event t () -> m (Event t S2C)
wsEv route msgSendEv = case checkEncoder fullRouteEncoder of
  Left err -> do
    el "div" $ text err
    return never
  Right encoder -> do
    let wsPath = fst $ encode encoder $ FullRoute_Backend BackendRoute_Network :/ ()
        sendEv = fmap ((:[]) . toStrict . Aeson.encode) msgSendEv
    let mUri = do
          uri' <- mkURI =<< route
          pathPiece <- nonEmpty =<< mapM mkPathPiece wsPath
          wsScheme <- case uriScheme uri' of
            rtextScheme | rtextScheme == mkScheme "https" -> mkScheme "wss"
            rtextScheme | rtextScheme == mkScheme "http" -> mkScheme "ws"
            _ -> Nothing
          return $ uri'
            { uriPath = Just (False, pathPiece)
            , uriScheme = Just wsScheme
            }
    case mUri of
      Nothing -> return never
      Just uri -> do
        ws <- webSocket (render uri) $ def & webSocketConfig_send .~ sendEv
        let mS2c = fromStrict <$> _webSocket_recv ws
        pure $ fmapMaybe Aeson.decode mS2c 

dynButton :: MonadWidget t m => Text -> m (Event t ())
dynButton s = do
  (e, _) <- el' "button" $ text s
  pure $ domEvent Click e