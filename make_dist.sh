#!/bin/sh

ARCH="${1:-linux-x64}"

rm -rf dist

npm run build || exit 1
npm run compile  || exit 1

cp -r web dist/web
cp -r resources dist/
cp -r locales/ dist/locales/
cp pkg.json dist/
cd dist

pkg index.js -c pkg.json --no-bytecode --public-packages "*" --public -t node18-$ARCH -o dizquetv
