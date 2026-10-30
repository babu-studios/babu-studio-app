#!/bin/sh
# Double-click this file to preview the website with working YouTube embeds.
# YouTube refuses to play on file:// pages (error 153), so this serves the
# site over http://127.0.0.1:8000 and opens it in your browser.
cd "$(dirname "$0")"
(sleep 1; open "http://127.0.0.1:8000/meta-hackathon/") &
echo "Preview running at http://127.0.0.1:8000/meta-hackathon/"
echo "Keep this window open while previewing. Close it to stop the server."
python3 -m http.server 8000
