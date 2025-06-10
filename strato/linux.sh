pushd ~/strato
sed -i '' -e 's|^- /opt/homebrew|# - /opt/homebrew|g' -e 's|^# - /usr|- /usr|g' -e 's|^  enable: false #|  enable: true #|g' -e 's|^- simulator|#- simulator|g' -e 's|^arch: aarch64|# arch: aarch64|g' strato/stack.yaml
popd
