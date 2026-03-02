#!/bin/bash
# Generate test voice fixtures using macOS `say` + ffmpeg
# Produces OGG files with known content for STT testing
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Generating voice fixtures in $DIR ..."

# hello-world.ogg — basic transcription
say -o "$DIR/hello-world.aiff" "hello world"
ffmpeg -y -loglevel error -i "$DIR/hello-world.aiff" -c:a libopus "$DIR/hello-world.ogg"
rm "$DIR/hello-world.aiff"
echo "  ✓ hello-world.ogg"

# numbers.ogg — multi-word accuracy
say -o "$DIR/numbers.aiff" "one two three four five"
ffmpeg -y -loglevel error -i "$DIR/numbers.aiff" -c:a libopus "$DIR/numbers.ogg"
rm "$DIR/numbers.aiff"
echo "  ✓ numbers.ogg"

# silence.ogg — 2s silence edge case
ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=16000:cl=mono -t 2 -c:a libopus "$DIR/silence.ogg"
echo "  ✓ silence.ogg"

echo "Done. Generated $(ls -1 "$DIR"/*.ogg | wc -l | tr -d ' ') fixtures."
