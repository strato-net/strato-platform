{-# LANGUAGE TemplateHaskell #-}

import Control.Monad
import Data.List
import Data.Maybe
import Data.Time.Clock.POSIX
import Data.Time.Format
import HFlags
import Numeric

defineFlag "zeroIt" False "Set the beginning of the run to the zero time"
defineFlag "showDiffs" False "Show the time diffs since the last log item"
$(return []) --see https://github.com/nilcons/hflags/issues/8

maybeRemoveBracket :: String -> (Maybe String, String)
maybeRemoveBracket input@('[' : rest) =
  case findIndex (== ']') rest of
    Nothing -> (Nothing, input)
    Just i ->
      let (first, second) = case splitAt i rest of
            (first', ']' : second') -> (first', second')
            _ -> error "Impossible"
       in (Just first, second)
maybeRemoveBracket x = (Nothing, x)

main :: IO ()
main = do
  _ <- $initHFlags "Tool to modify log timestamps"
  theLines <- fmap lines getContents
  showOutput Nothing Nothing theLines

showOutput :: Maybe POSIXTime -> Maybe POSIXTime -> [String] -> IO ()
showOutput _ _ [] = return ()
showOutput maybeZeroTime maybeOldTime (l : rest) = do
  let (maybeTimeString, restOfLine) = maybeRemoveBracket l
  case maybeTimeString of
    Nothing -> do
      putStrLn l
      showOutput maybeZeroTime maybeOldTime rest
    Just timeString -> do
      let theTime = utcTimeToPOSIXSeconds $ parseTimeOrError True defaultTimeLocale "%Y-%m-%d %H:%M:%S%Q %Z" timeString
      case maybeZeroTime of
        Nothing -> putStr "--"
        Just zeroTime ->
          putStr $ showFFloat Nothing (realToFrac (if flags_zeroIt then theTime - zeroTime else theTime) :: Double) ""
      when flags_showDiffs $
        case maybeOldTime of
          (Just oldTime) -> putStr $ " " ++ showFFloat Nothing (realToFrac (theTime - oldTime) :: Double) ""
          Nothing -> putStr " --"
      putStrLn $ " " ++ restOfLine

      showOutput (Just $ fromMaybe theTime maybeZeroTime) (Just theTime) rest
