#!/usr/bin/env bash
set -e
set -x

SINGLE_NODE=${SINGLE_NODE:-false}
STRATO_GS_MODE=${STRATO_GS_MODE:-0}

# sed -i "s|__NODE_NAME__|$NODE_NAME|g" build/index.html
sed -i "s|__BLOC_URL__|$BLOC_URL|g" build/index.html
sed -i "s|__STRATO_URL__|$STRATO_URL|g" build/index.html
# sed -i "s|__STRATO_DOC_URL__|$STRATO_DOC_URL|g" build/index.html
# sed -i "s|__BLOC_DOC_URL__|$BLOC_DOC_URL|g" build/index.html
sed -i "s|__CIRRUS_URL__|$CIRRUS_URL|g" build/index.html
# sed -i "s|__APEX_URL__|$APEX_URL|g" build/index.html
# sed -i "s|__STRATO_GS_MODE__|$STRATO_GS_MODE|g" build/index.html
# sed -i "s|__SINGLE_NODE__|$SINGLE_NODE|g" build/index.html

# Started by non-BA user (smd_container_started)
# if [ "$STRATO_GS_MODE" != "1" ]; then
#   curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZCIsCiAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidG9rZW4iOiAiZGFmMTcxZTkwMzBhYmIzZTMwMmRmOWQ3OGI2YjFhYTAiCiAgICB9Cn0=&ip=1
# fi
# # Started locally (smd_container_started_local)
# if [ "$STRATO_GS_MODE" = "0" ]; then
#   curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZF9sb2NhbCIsCiAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidG9rZW4iOiAiZGFmMTcxZTkwMzBhYmIzZTMwMmRmOWQ3OGI2YjFhYTAiCiAgICB9Cn0=&ip=1
# fi
# # Started on Azure (smd_container_started_azure)
# if [ "$STRATO_GS_MODE" = "2" ]; then
#   curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZF9henVyZSIsCiAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidG9rZW4iOiAiZGFmMTcxZTkwMzBhYmIzZTMwMmRmOWQ3OGI2YjFhYTAiCiAgICB9Cn0=&ip=1
# fi
# # Started on AWS (smd_container_started_aws)
# if [ "$STRATO_GS_MODE" = "3" ]; then
#   curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZF9hd3MiLAogICAgInByb3BlcnRpZXMiOiB7CiAgICAgICAgInRva2VuIjogImRhZjE3MWU5MDMwYWJiM2UzMDJkZjlkNzhiNmIxYWEwIgogICAgfQp9&ip=1
# fi

serve -l 3000 build
