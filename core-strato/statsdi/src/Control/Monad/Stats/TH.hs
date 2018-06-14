module Control.Monad.Stats.TH
    ( defineCounter
    , defineGauge
    , defineTimer
    , defineHistogram
    , defineSet
    , defineServiceCheck
    , __mkByteString
    ) where

import           Control.Monad
import qualified Data.ByteString.Char8        as Char8
import           Data.Char
import           Data.List
import           Text.ParserCombinators.ReadP

import qualified Language.Haskell.TH          as TH

--
-- defineCounter "vm.txs_processed" [("vm_type", "evm")]
-- # quasiquotes out to
-- # vm_txs_processed = Counter { counterName = "vm.txs_processed", counterTags = [("vm_type", "evm")] }

-- IMPORTANT: lets the quasiquoters run. pls keep
__mkByteString :: String -> Char8.ByteString
__mkByteString = Char8.pack

defField :: String -> [TH.FieldExp] -> String -> [(String, String)] -> TH.DecsQ
defField typeName moreFields metricName metricTags = do
    unless (isValidMetricName metricName) . fail $ metricName ++ " is not a valid name for a " ++ typeName
    validatedTags <- sequence $ transformTag <$> metricTags
    let type'         = TH.mkName typeName
        nameFieldName = TH.mkName $ snek typeName ++ "Name"
        nameFieldExp  = (nameFieldName, bsp metricName)
        tagsFieldName = TH.mkName $ snek typeName ++ "Tags"
        tagsFieldExp  = (tagsFieldName, TH.ListE (tagE <$> validatedTags))
        allFieldExps  = nameFieldExp : tagsFieldExp : moreFields
        varName       = mkMetricName metricName
        varP          = TH.VarP varName
        sig           = TH.SigD varName (TH.ConT type')
        val           = TH.ValD varP (TH.NormalB (TH.RecConE type' allFieldExps)) []
        char8Pack     = TH.mkName "__mkByteString"
        bsp           = TH.AppE (TH.VarE char8Pack) . TH.LitE . TH.StringL
        tagE (metName, metVal) = TH.TupE [bsp metName, bsp metVal]
    return [sig, val]


defineCounter :: String -> [(String, String)] -> TH.DecsQ
defineCounter = defField "Counter" []

defineGauge :: String -> [(String, String)] -> TH.DecsQ
defineGauge = defField "Gauge" []

defineTimer :: String -> [(String, String)] -> TH.DecsQ
defineTimer = defField "Timer" []

defineHistogram :: String -> [(String, String)] -> Rational -> TH.DecsQ
defineHistogram metricName metricTags sampleRate = do
    when (sampleRate < 0.0 || sampleRate > 1.0) . fail $ "Histogram sample rate must be between 0.0 and 1.0"
    defField "Histogram" [sampleRateField] metricName metricTags
    where sampleRateField = (TH.mkName "_histogramSampleRate", TH.LitE (TH.RationalL sampleRate))

defineSet :: String -> [(String, String)] -> TH.DecsQ
defineSet = defField "Set" []

defineServiceCheck :: String -> [(String, String)] -> TH.DecsQ
defineServiceCheck = defField "ServiceCheck" []

transformTag :: (String, String) -> TH.Q (String, String)
transformTag (name, value) = do
    let strippedName  = stripTrailingUnderscores name
        strippedValue = stripTrailingUnderscores value
        ret = (strippedName, strippedValue)
    unless (isValidTagName name) . fail $ "Tag name `" ++ name ++ "` is not a valid name.`"
    unless (isValidTagValueForm value) . fail $ "Tag value`" ++ name ++ "` is not a valid value.`"
    unless ((length strippedValue + length strippedValue) <= 199) . fail $ "Tag `" ++ show ret ++ "` ends up longer than 200 chars`"
    return ret

satisfiesParser :: ReadP a -> String -> Bool
satisfiesParser p = predicate . readP_to_S p
    where predicate hits = not (null hits) && length hits == 1

isValidMetricName :: String -> Bool
isValidMetricName = not . null . readP_to_S validateMetricName

isValidTag :: (String, String) -> Bool
isValidTag (name, val) = isValidTagName name

isValidTagName :: String -> Bool
isValidTagName name = isValidTagNameForm name && name /= "device"

isValidTagNameForm :: String -> Bool
isValidTagNameForm = satisfiesParser validateTagName

isValidTagValueForm :: String -> Bool
isValidTagValueForm = satisfiesParser validateTagValue

isAsciiAlpha    :: Char -> Bool
isAsciiAlpha     c = isAscii c && isAlpha c
isAsciiAlphaNum :: Char -> Bool
isAsciiAlphaNum  c = isAscii c && isAlphaNum c

validateMetricName :: ReadP String
validateMetricName = do
    first <- satisfy isAsciiAlpha
    rest <- flip manyTill eof $ satisfy (\c -> c `elem` "_." || isAsciiAlphaNum c)
    return $ first : rest

validateTagName :: ReadP String
validateTagName = do
    first <- satisfy isAsciiAlpha
    rest <- flip manyTill eof $ satisfy (\c -> c `elem` "_-." || isAsciiAlphaNum c)
    return $ first : rest

validateTagValue :: ReadP String
validateTagValue = flip manyTill eof $ satisfy (\c -> c `elem` "_-." || isAsciiAlphaNum c)

stripTrailingUnderscores :: String -> String
stripTrailingUnderscores = reverse . dropWhile (== '_') . reverse

mkMetricName :: String -> TH.Name
mkMetricName = TH.mkName . fmap makeUnderscores
    where makeUnderscores c = if isAsciiAlphaNum c then c else '_'

snek :: String -> String
snek ""     = ""
snek (c:cs) = toLower c : cs
