#!/bin/sh
set -eu
src="${1:-$HOME/projects/mlx/docs/monograph}"
out="$(cd "$(dirname "$0")/.." && pwd)/monograph"
mkdir -p "$out/images"
cp "$src"/images/*.png "$out/images/"
blob="https://github.com/goodmai/basalt/blob/main"
for lang in ru en fr es zh ar; do
  dir=ltr; [ "$lang" = ar ] && dir=rtl
  title=$(head -1 "$src/evo.$lang.md" | sed 's/^# //; s/\*//g')
  perl -pe "s{\]\(evo\.(ru|en|fr|es|zh|ar)\.md\)}{](\1.html)}g; s{\]\(\.\./\.\./}{]($blob/}g; s{\]\(\.\./}{]($blob/docs/}g" "$src/evo.$lang.md" |
    sed '1d' |
    pandoc -f gfm -t html5 -s --toc --toc-depth=2 \
      --metadata title="$title" --metadata lang="$lang" -V dir="$dir" \
      --css monograph.css -o "$out/$lang.html"
done
echo "built $out"
