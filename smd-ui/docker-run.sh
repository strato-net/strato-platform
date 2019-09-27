#!/usr/bin/env bash
set -e
set -x

SINGLE_NODE=${SINGLE_NODE:-false}
STRATO_GS_MODE=${STRATO_GS_MODE:-0}
ssl=${ssl:-false}

sed -i "s|__NODE_HOST__|$NODE_HOST|g" build/index.html
sed -i "s|__NODE_NAME__|$NODE_NAME|g" build/index.html
sed -i "s|__OAUTH_ENABLED__|$OAUTH_ENABLED|g" build/index.html
sed -i "s|__STRATO_GS_MODE__|$STRATO_GS_MODE|g" build/index.html
sed -i "s|__SINGLE_NODE__|$SINGLE_NODE|g" build/index.html
sed -i "s|__IS_SSL__|$ssl|g" build/index.html
sed -i "s|__SMD_MODE__|$SMD_MODE|g" build/index.html
sed -i "s|__EXT_STORAGE_S3_BUCKET__|$EXT_STORAGE_S3_BUCKET|g" build/index.html
sed -i "s|__STRATO_VERSION__|$STRATO_VERSION|g" build/index.html

# Started by non-BA user (smd_container_started)
if [ "$STRATO_GS_MODE" != "1" ]; then
  curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZCIsCiAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidG9rZW4iOiAiZGFmMTcxZTkwMzBhYmIzZTMwMmRmOWQ3OGI2YjFhYTAiCiAgICB9Cn0=&ip=1
fi
# Started locally (smd_container_started_local)
if [ "$STRATO_GS_MODE" = "0" ]; then
  curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZF9sb2NhbCIsCiAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidG9rZW4iOiAiZGFmMTcxZTkwMzBhYmIzZTMwMmRmOWQ3OGI2YjFhYTAiCiAgICB9Cn0=&ip=1
fi
# Started on Azure (smd_container_started_azure)
if [ "$STRATO_GS_MODE" = "2" ]; then
  curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZF9henVyZSIsCiAgICAicHJvcGVydGllcyI6IHsKICAgICAgICAidG9rZW4iOiAiZGFmMTcxZTkwMzBhYmIzZTMwMmRmOWQ3OGI2YjFhYTAiCiAgICB9Cn0=&ip=1
fi
# Started on AWS (smd_container_started_aws)
if [ "$STRATO_GS_MODE" = "3" ]; then
  curl http://api.mixpanel.com/track/?data=ewogICAgImV2ZW50IjogInNtZF9jb250YWluZXJfc3RhcnRlZF9hd3MiLAogICAgInByb3BlcnRpZXMiOiB7CiAgICAgICAgInRva2VuIjogImRhZjE3MWU5MDMwYWJiM2UzMDJkZjlkNzhiNmIxYWEwIgogICAgfQp9&ip=1
fi

serve -l 3002 build
