{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Components.PieChart where

import Reflex.Dom.Core
import qualified Data.Text as T
import qualified Data.Map as Map

-- Data point for pie chart
data PieData = PieData
  { pdValue :: Double
  , pdLabel :: T.Text
  , pdColor :: T.Text
  }

-- Configuration for the PieChart component
data PieChartConfig = PieChartConfig
  { pcData :: [PieData]  -- Data points to display
  , pcTitle :: T.Text    -- Title for the chart
  }

-- Default configuration
defaultPieChartConfig :: PieChartConfig
defaultPieChartConfig = PieChartConfig
  { pcData = []
  , pcTitle = ""
  }

-- PieChart component
pieChart :: (MonadWidget t m) => PieChartConfig -> m ()
pieChart config = do
  let total = sum $ map pdValue (pcData config)
      radius = 100 :: Double
      centerX = radius
      centerY = radius
      -- colors :: [String] = cycle ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"]
  
  elAttr "div" (Map.singleton "class" "pie-chart") $ do
    -- Chart title
    el "h3" $ text (pcTitle config)
    
    -- Chart container
    elSvgAttr "svg" (Map.fromList
      [ ("width", T.pack $ show (radius * 2))
      , ("height", T.pack $ show (radius * 2))
      ]) $ do
      
      -- Draw pie slices
      let slices = calculateSlices (pcData config) total
      sequence_ $ zipWith (drawSlice centerX centerY radius) [0..] slices
      
      -- Add legend
      drawLegend (zip (pcData config) slices)

elSvgAttr :: MonadWidget t m => T.Text -> Map.Map T.Text T.Text -> m a -> m a
elSvgAttr elTag attrs = fmap snd . elDynAttrNS' (Just "http://www.w3.org/2000/svg") elTag (constDyn attrs)

-- Calculate slice angles and percentages
calculateSlices :: [PieData] -> Double -> [(Double, Double)]
calculateSlices dataPoints total = 
  let percentages = map (\pd -> pdValue pd / total) dataPoints
      angles = scanl (+) 0 $ map (* 360) percentages
  in zip angles percentages

-- Draw a single pie slice
drawSlice :: (MonadWidget t m)
          => Double  -- Center X
          -> Double  -- Center Y
          -> Double  -- Radius
          -> Int     -- Index
          -> (Double, Double)  -- (Start angle, Percentage)
          -> m ()
drawSlice centerX centerY radius index (startAngle, percentage) = do
  let endAngle = startAngle + (percentage * 360)
      startRad = startAngle * pi / 180
      endRad = endAngle * pi / 180
      startX = centerX + radius * cos startRad
      startY = centerY + radius * sin startRad
      endX = centerX + radius * cos endRad
      endY = centerY + radius * sin endRad
      largeArc = if endAngle - startAngle > 180 then (1 :: Integer) else 0
  
  elSvgAttr "path" (Map.fromList
    [ ("d", T.pack $ concat
        [ "M ", show centerX, ",", show centerY
        , " L ", show startX, ",", show startY
        , " A ", show radius, ",", show radius
        , " 0 ", show largeArc, ",1 "
        , show endX, ",", show endY
        , " Z"
        ])
    , ("fill", T.pack $ cycle ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"] !! index)
    , ("class", "slice")
    ]) $ return ()

-- Draw the legend
drawLegend :: (MonadWidget t m) => [(PieData, (Double, Double))] -> m ()
drawLegend items = do
  elAttr "div" (Map.singleton "class" "legend") $ do
    sequence_ $ map drawLegendItem items

-- Draw a single legend item
drawLegendItem :: (MonadWidget t m) => (PieData, (Double, Double)) -> m ()
drawLegendItem (PieData _ label _, (_, percentage)) = do
  elAttr "div" (Map.singleton "class" "legend-item") $ do
    elAttr "span" (Map.singleton "class" "legend-color") $ return ()
    el "span" $ text $ T.concat
      [ label
      , " ("
      , T.pack $ show $ (round (percentage * 100) :: Integer)
      , "%)"
      ] 