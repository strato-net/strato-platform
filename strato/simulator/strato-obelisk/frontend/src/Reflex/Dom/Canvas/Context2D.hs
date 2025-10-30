{-# LANGUAGE DeriveFoldable            #-}
{-# LANGUAGE DeriveFunctor             #-}
{-# LANGUAGE DeriveTraversable         #-}
{-# LANGUAGE FlexibleContexts          #-}
{-# LANGUAGE FlexibleInstances         #-}
{-# LANGUAGE MultiParamTypeClasses     #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE RankNTypes                #-}
module Reflex.Dom.Canvas.Context2D where

import           Control.Monad.Free.Church          (F, foldF, liftF)
import           Data.Text                          (Text)

import           GHCJS.DOM.CanvasPath               as C
import           GHCJS.DOM.CanvasRenderingContext2D as C
import           GHCJS.DOM.Enums as C

import           GHCJS.DOM.Types                    (JSString, MonadJSM, CanvasImageSource, IsCanvasImageSource, toCanvasImageSource)

data CanvasF a
  = Transform Float Float Float Float Float Float a
  | Fill CanvasWindingRule a
  | FillRect Float Float Float Float a
  | FillText Text Float Float (Maybe Float) a
  | FillStyle JSString a
  | BeginPath a
  | MoveTo Double Double a
  | LineWidth Float a
  | LineTo Double Double a
  | ClosePath a
  | StrokeStyle JSString a
  | Stroke a
  | Clip CanvasWindingRule a
  | QuadraticCurveTo Double Double Double Double a
  | BezierCurveTo Double Double Double Double Double Double a
  | Arc Double Double Double Double Double Bool a
  | ArcTo Double Double Double Double Double a
  | Rect Double Double Double Double a
  | ClearRect Float Float Float Float a
  | StrokeRect Float Float Float Float a
  | DrawImage CanvasImageSource Float Float a
  | Done a
  deriving (Functor, Foldable, Traversable)

type CanvasM = F CanvasF

drawToCanvas
  :: MonadJSM m
  => F CanvasF a
  -> C.CanvasRenderingContext2D
  -> m a
drawToCanvas instructions cxt =
  foldF ( applyInstruction cxt ) instructions

applyInstruction :: MonadJSM m => C.CanvasRenderingContext2D -> CanvasF a -> m a
applyInstruction cxt instruction =
  case instruction of
    BeginPath cont             -> cont <$ C.beginPath cxt
    ClearRect x y w h cont     -> cont <$ C.clearRect cxt x y w h
    Clip rule cont             -> cont <$ C.clip cxt (Just rule)
    ClosePath cont             -> cont <$ C.closePath cxt
    Fill rule cont             -> cont <$ C.fill cxt ( Just rule )
    FillRect x y w h cont      -> cont <$ C.fillRect cxt x y w h
    FillText t x y w cont      -> cont <$ C.fillText cxt t x y w
    FillStyle style cont       -> cont <$ C.setFillStyle cxt style
    LineTo x y cont            -> cont <$ C.lineTo cxt x y
    LineWidth w cont           -> cont <$ C.setLineWidth cxt w
    MoveTo x y cont            -> cont <$ C.moveTo cxt x y
    Rect x y w h cont          -> cont <$ C.rect cxt x y w h
    Stroke cont                -> cont <$ C.stroke cxt
    StrokeRect x y w h cont    -> cont <$ C.strokeRect cxt x y w h
    StrokeStyle style cont     -> cont <$ C.setStrokeStyle cxt style
    Transform a b c d e f cont -> cont <$ C.transform cxt a b c d e f

    Arc x y radius startAngle endAngle anticlockwise cont -> cont <$ C.arc cxt x y radius startAngle endAngle anticlockwise
    ArcTo cp1_X cp1_Y cp2_X cp2_Y radius cont             -> cont <$ C.arcTo cxt cp1_X cp1_Y cp2_X cp2_Y radius
    BezierCurveTo cp1_X cp1_Y cp2_X cp2_Y endX endY cont  -> cont <$ C.bezierCurveTo cxt cp1_X cp1_Y cp2_X cp2_Y endX endY
    QuadraticCurveTo cpX cpY endX endY cont               -> cont <$ C.quadraticCurveTo cxt cpX cpY endX endY

    DrawImage img dw dh cont                              -> cont <$ C.drawImage cxt img dw dh

    Done a                     -> pure a

fillF :: CanvasM ()
fillF = liftF $ Fill C.CanvasWindingRuleEvenodd ()

fillStyleF :: JSString -> CanvasM ()
fillStyleF style = liftF $ FillStyle style ()

strokeF :: CanvasM ()
strokeF = liftF $ Stroke ()

strokeStyleF :: JSString -> CanvasM ()
strokeStyleF style = liftF $ StrokeStyle style ()

beginPathF :: CanvasM ()
beginPathF = liftF $ BeginPath ()

closePathF :: CanvasM ()
closePathF = liftF $ ClosePath ()

clipF :: CanvasWindingRule -> CanvasM ()
clipF rule = liftF $ Clip rule ()

rectF :: Double -> Double -> Double -> Double -> CanvasM ()
rectF x y h w = liftF $ Rect x y w h ()

doneF :: CanvasM ()
doneF = liftF $ Done ()

moveToF :: Double -> Double -> CanvasM ()
moveToF x y = liftF $ MoveTo x y ()

lineToF :: Double -> Double -> CanvasM ()
lineToF x y = liftF $ LineTo x y ()

setLineWidthF :: Float -> CanvasM ()
setLineWidthF w = liftF $ LineWidth w ()

clearRectF, fillRectF, strokeRectF :: Float -> Float -> Float -> Float -> CanvasM ()
clearRectF x y w h  = liftF $ ClearRect x y w h ()
fillRectF x y w h   = liftF $ FillRect x y w h ()
strokeRectF x y w h = liftF $ StrokeRect x y w h ()

fillTextF :: Text -> Float -> Float -> Maybe Float -> CanvasM ()
fillTextF t x y w = liftF $ FillText t x y w ()

drawImageF :: IsCanvasImageSource a => a -> Float -> Float -> CanvasM ()
drawImageF i x y = liftF $ DrawImage (toCanvasImageSource i) x y ()

quadraticCurveToF :: Double -> Double -> Double -> Double -> CanvasM ()
quadraticCurveToF cpX cpY endX endY = liftF $ QuadraticCurveTo cpX cpY endX endY ()

bezierCurveToF :: Double -> Double -> Double -> Double -> Double -> Double -> CanvasM ()
bezierCurveToF cp1_X cp1_Y cp2_X cp2_Y endX endY = liftF $ BezierCurveTo cp1_X cp1_Y cp2_X cp2_Y endX endY ()

arcF :: Double -> Double -> Double -> Double -> Double -> Bool -> CanvasM ()
arcF x y radius startAngle endAngle anticlockwise = liftF $ Arc x y radius startAngle endAngle anticlockwise ()

arcToF :: Double -> Double -> Double -> Double -> Double -> CanvasM ()
arcToF cp1_X cp1_Y cp2_X cp2_Y radius = liftF $ ArcTo cp1_X cp1_Y cp2_X cp2_Y radius ()