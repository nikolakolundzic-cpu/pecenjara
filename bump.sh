#!/bin/bash
# Povećava verziju aplikacije na svim mjestima (config.js, sw.js, index.html), da telefoni preuzmu novu verziju.
set -e
cd "$(dirname "$0")"
old=$(grep -o 'PECENJE_VERZIJA = "[0-9]*"' config.js | grep -o '[0-9]*')
new=$((old + 1))
sed -i "s/PECENJE_VERZIJA = \"$old\"/PECENJE_VERZIJA = \"$new\"/" config.js
sed -i "s/pecenje-v$old'/pecenje-v$new'/" sw.js
sed -i "s/config.js?v=$old\"/config.js?v=$new\"/; s/shim.js?v=$old\"/shim.js?v=$new\"/" index.html
echo "verzija $old -> $new"
