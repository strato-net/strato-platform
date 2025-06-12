pushd ~/strato
sed -i '' -e 's|^\([^#].*\)GHCJS$|#\1GHCJS|g' -e 's|^#\(.*\)GHC$|\1GHC|g' strato/stack.yaml
popd
