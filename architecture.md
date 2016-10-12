# Overview

##  Mappings
- 3000 : postgrest
- 3333 : cirrus
- 80   : strato-api
- 8000 : bloc

## Tables

:3000

## Flow

1. `bloc` uploads a contract. It POSTs to `postgrest/contracts` route, effectively storing it in the `ContractName -> codeHash` mapping.
2. `cirrus` gets notified on the `/listen` route that we want sea