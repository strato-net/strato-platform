
#!/usr/bin/env bash
set -e
set -x

echo 'Starting network-onboarding-ui...'

serve --single build
echo 'Done!'

tail -f /dev/null