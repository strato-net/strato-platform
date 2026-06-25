#!/usr/bin/env sh
set -e
set -x

# Process template variables in config.js. Write via a temp file and overwrite
# (rather than `sed -i`, which creates its temp in the dir) so this works when
# running as a non-root user with only the file itself made writable.
sed -e "s|__OAUTH_ENABLED__|true|g" \
    -e "s|__STRATO_VERSION__|$STRATO_VERSION|g" \
    -e "s|__POLLING_FREQUENCY__|$POLLING_FREQUENCY|g" \
    build/scripts/config.js > /tmp/config.js
cat /tmp/config.js > build/scripts/config.js

exec env NO_UPDATE_CHECK=1 serve --single -l 3002 build
