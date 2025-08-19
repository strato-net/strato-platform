{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.BarGraph where

import Reflex.Dom.Core
import qualified Data.Text as T
import qualified Data.Map as Map

-- Configuration for the BarGraph component
data BarGraphConfig = BarGraphConfig
  { bgData :: [Double]  -- Data points to display
  , bgLabel :: T.Text   -- Label for the graph
  , bgIdentifier :: T.Text  -- Unique identifier for the graph
  , bgUnits :: Maybe T.Text  -- Optional units for the data
  }

-- Default configuration
defaultBarGraphConfig :: BarGraphConfig
defaultBarGraphConfig = BarGraphConfig
  { bgData = []
  , bgLabel = ""
  , bgIdentifier = ""
  , bgUnits = Nothing
  }

elSvgAttr :: MonadWidget t m => T.Text -> Map.Map T.Text T.Text -> m a -> m a
elSvgAttr elTag attrs = fmap snd . elDynAttrNS' (Just "http://www.w3.org/2000/svg") elTag (constDyn attrs)

-- BarGraph component
barGraph :: (MonadWidget t m) => BarGraphConfig -> m ()
barGraph config = do
  let maxValue = if null (bgData config)
        then 0
        else maximum (bgData config)
      height = 200 :: Double
      width = 300 :: Double
      barWidth = 25 :: Double
  
  elAttr "div" (Map.singleton "class" "bar-graph") $ do
    -- Graph title
    el "h3" $ text (bgLabel config)
    
    -- Graph container
    elSvgAttr "svg" (Map.fromList
      [ ("width", T.pack $ show width)
      , ("height", T.pack $ show height)
      , ("id", bgIdentifier config)
      ]) $ do
      
      -- Draw bars
      sequence_ $ zipWith (drawBar height width barWidth maxValue) [0..] (bgData config)
      
      -- Add units if specified
      case bgUnits config of
        Just units -> do
          elSvgAttr "text" (Map.fromList
            [ ("x", "0")
            , ("y", T.pack $ show (height + 20))
            , ("class", "units")
            ]) $ text units
        Nothing -> return ()

-- Helper function to draw a single bar
drawBar :: (MonadWidget t m)
        => Double  -- Total height
        -> Double  -- Total width
        -> Double  -- Bar width
        -> Double  -- Max value
        -> Int     -- Index
        -> Double  -- Value
        -> m ()
drawBar totalHeight _ barWidth maxValue index val = do
  let x = fromIntegral index * barWidth
      barHeight = if maxValue == 0
        then 0
        else (val / maxValue) * totalHeight
      y = totalHeight - barHeight
  
  elSvgAttr "rect" (Map.fromList
    [ ("x", T.pack $ show x)
    , ("y", T.pack $ show y)
    , ("width", T.pack $ show (barWidth - 2))  -- -2 for spacing
    , ("height", T.pack $ show barHeight)
    , ("class", "bar")
    ]) $ return ()
  
  -- Add value label
  elSvgAttr "text" (Map.fromList
    [ ("x", T.pack $ show (x + barWidth/2))
    , ("y", T.pack $ show (y - 5))
    , ("class", "value")
    ]) $ text (T.pack $ show val) 