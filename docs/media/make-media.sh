#!/usr/bin/env bash
# Regenerates the README animations in docs/media from the real UI.
#
#   docs/media/make-media.sh [gif ...]    (default: all; names below)
#
# Needs Obsidian running with this repo's scripts in the vault (FLY_VAULT or
# ~/.config/fly-genetics/env, as for tests/), plus ffmpeg and magick.
# Each animation is driven by docs/media/media.js inside the test harness's
# throwaway drawing (Excalidraw/_test-harness, trashed afterwards). Frames are
# captured already cropped to that drawing's canvas (plus an open script
# modal); they are written to a temp dir, copied to docs/media/frames/<gif>/
# for review, and assembled into docs/media/<gif>.gif (800 px wide, 1.2 s per
# frame, 2.5 s on the last, looping, one shared palette).
set -euo pipefail
MEDIA="$(cd "$(dirname "$0")" && pwd)"
ALL=(genotype cross cross-mode tidy break-cross)
if (( $# )); then GIFS=("$@"); else GIFS=("${ALL[@]}"); fi
source "$MEDIA/../../tests/lib.sh" # cds to the vault; defines ev, fly_test

WORK=$(mktemp -d)
# Sidebar state, restored at the end (media.js collapses them only if the
# drawing area is too narrow for the crop box).
SIDEBARS=$(ev "JSON.stringify({l:app.workspace.leftSplit.collapsed,r:app.workspace.rightSplit.collapsed})")
restore() {
  ev "(()=>{const s=$SIDEBARS;const L=app.workspace.leftSplit,R=app.workspace.rightSplit;s.l?L.collapse():L.expand();s.r?R.collapse():R.expand();window.__mediaOut=undefined;return 1})()" >/dev/null || true
  rm -rf "$WORK"
}
trap restore EXIT

# Opens the throwaway drawing as a tab next to the active one, so it gets the
# whole main area (the harness would otherwise open it in a split pane, half
# as wide). The harness then reuses this tab.
prepare() {
  ev "(()=>{window.__mediaPrep='busy';(async()=>{
    const D='Excalidraw/_test-harness.excalidraw.md', sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const find=()=>app.workspace.getLeavesOfType('excalidraw').find(l=>l.view?.file?.path===D);
    const group=app.workspace.activeLeaf?.parent;
    if(!find()){
      if(!app.vault.getAbstractFileByPath(D)){const ea=ExcalidrawAutomate;ea.reset();ea.create({filename:'_test-harness',foldername:'Excalidraw',onNewPane:true});}
      else{const l=app.workspace.getLeaf('tab');await l.setViewState({type:'excalidraw',state:{file:D},active:true});}
      for(let i=0;i<200&&!find();i++)await sleep(25);
    }
    const leaf=find();
    if(!leaf)throw new Error('could not open '+D);
    if(group&&leaf.parent!==group&&group.containerEl?.isConnected){
      const tab=app.workspace.createLeafInParent(group,group.children.length);
      await tab.setViewState({type:'excalidraw',state:{file:D},active:true});
      leaf.detach();
    }
  })().then(()=>window.__mediaPrep='ok',e=>window.__mediaPrep='error: '+e.message)})()" >/dev/null
  local s
  for ((i = 0; i < 200; i++)); do
    s=$(ev "window.__mediaPrep")
    [[ "$s" != busy ]] && break
    perl -e 'select(undef,undef,undef,0.05)'
  done
  [[ "$s" == ok ]] || { echo "FAIL: prepare: $s"; exit 1; }
}

for gif in "${GIFS[@]}"; do
  echo "== $gif"
  prepare
  ev "(()=>{window.__mediaOut='$WORK';return 1})()" >/dev/null
  # Subshell: fly_test sets its own EXIT trap.
  (fly_test <<JS
(0, eval)(require('fs').readFileSync('$MEDIA/media.js', 'utf8'));
await window.__flyMedia.run(T, F, '$gif');
JS
  ) || { echo "FAIL: $gif capture"; exit 1; }

  src="$WORK/$gif"
  frames=("$src"/*.png)
  (( ${#frames[@]} >= 2 )) || { echo "FAIL: $gif has ${#frames[@]} frames"; exit 1; }
  rm -rf "$MEDIA/frames/$gif" && mkdir -p "$MEDIA/frames/$gif"
  cp "${frames[@]}" "$MEDIA/frames/$gif/"

  # All frames to one size (the first frame's; a frame that grew to cover a
  # modal is scaled down to fit and padded), then 800 px wide.
  size=$(magick identify -format '%wx%h' "${frames[0]}")
  mkdir -p "$src/n"
  for f in "${frames[@]}"; do
    bg=$(magick "$f" -format '%[pixel:p{2,2}]' info:)
    magick "$f" -resize "$size" -background "$bg" -gravity center -extent "$size" -resize 800x "$src/n/$(basename "$f")"
  done
  # One palette from all frames (ffmpeg), then frames with their delays
  # (magick): 1.2 s each, 2.5 s on the last.
  list="$src/list.txt"; : >"$list"
  for f in "$src"/n/*.png; do printf "file '%s'\n" "$f" >>"$list"; done
  ffmpeg -v error -y -f concat -safe 0 -i "$list" -vf "palettegen=max_colors=128:stats_mode=full" -update 1 "$src/palette.png"
  n=("$src"/n/*.png)
  magick -delay 120 "${n[@]:0:${#n[@]}-1}" -delay 250 "${n[@]: -1}" +dither -remap "$src/palette.png" \
    -layers optimize -loop 0 "$MEDIA/$gif.gif"
  echo "$gif.gif: ${#frames[@]} frames, $(du -k "$MEDIA/$gif.gif" | cut -f1) KB, delays $(magick identify -format '%T ' "$MEDIA/$gif.gif")"
done
