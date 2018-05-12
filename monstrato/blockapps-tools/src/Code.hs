module Code where
import           Blockchain.Data.Code
import           DumpLevelDB


doit :: String -> String -> IO ()
doit dbtype h = showKeyVal (show . Code) dbtype "code" (if h == "-" then Nothing else Just h)






