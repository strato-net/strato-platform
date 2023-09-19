{-# LANGUAGE LambdaCase #-}

--import Control.Monad
--import Control.Monad.Trans.Class
--import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as BC
import Data.Conduit
import Data.Conduit.List (sourceList)
import qualified Database.LevelDB as LDB
import qualified LabeledError
import LevelDBTools

main :: IO ()
main = do
  c <- map BC.words . BC.lines <$> BC.getContents
  -- let input = map (\[x, y] -> (LevelKV (LabeledError.b16Decode "insertLDB.hs" x) (LabeledError.b16Decode "insertLDB.hs" y))) c
  let input =
        map
          ( \case
              [] -> error "Input list is empty"
              [_] -> error "Input list contains only one element"
              [x, y] -> (LevelKV (LabeledError.b16Decode "insertLDB.hs" x) (LabeledError.b16Decode "insertLDB.hs" y))
              _ -> error "Input list contains more than two elements"
          )
          c

  {-
    _  <- LDB.runResourceT $ do
      ldb <- LDB.open "abcd2" LDB.defaultOptions{LDB.createIfMissing=True}
      forM input $ \(k, v) -> do
        LDB.put ldb LDB.defaultWriteOptions (fst $ B16.decode k) (fst $ B16.decode v)
  --      liftIO $ putStrLn $ show (BC.length k) ++ " " ++ show (BC.length v)
  --      liftIO $ putStrLn $ show (fst $ B16.decode k) ++ " " ++ show (fst $ B16.decode v)
  -}

  _ <- LDB.runResourceT $ do
    db <- LDB.open "abcd2" LDB.defaultOptions {LDB.createIfMissing = True}
    runConduit $ sourceList input .| outputToLDB db

  return ()
