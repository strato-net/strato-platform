{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE Strict #-}
{-# OPTIONS_GHC -Wall #-}

module Data.ProcessInfo where

import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T
import Text.Read (readMaybe)

data ProcessInfo = ProcessInfo
  { piPercentCpu :: !Double
  , piMemUsage   :: !Double
  , piCommand    :: !Text
  }

parseProcessInfo :: String -> Maybe ProcessInfo
parseProcessInfo input = case words input of
  (cpuStr : memStr : cmd : _) -> do
    cpu <- readMaybe cpuStr
    mem <- (1000*) <$> readMaybe memStr
    pure $ ProcessInfo cpu mem (T.pack cmd)
  _ -> Nothing

mergeProcessInfo :: ProcessInfo -> Map Text ProcessInfo -> Map Text ProcessInfo
mergeProcessInfo p m = m <> M.singleton (piCommand p) p

createProcessMap :: [String] -> Map Text ProcessInfo
createProcessMap = foldr go M.empty
  where go cmd m = maybe m (flip mergeProcessInfo m) $ parseProcessInfo cmd