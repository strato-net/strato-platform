# nginx proxy for hoogle

## Overview

This is an nginx deployment to proxy all requests coming to the hoogle docs to enable Google Workspace authentication for blockapps folks:

- hoogle docs (https://hoogle.internal.blockapps.net - the hoogle docs generated and deployed by Jenkins STRATO_hoogle job using `make hoogle_generate` in strato-platform)
