# Third-party notices

ClipBay is MIT-licensed. It relies on the following third-party software:

## Electron
MIT License. https://github.com/electron/electron

## ffmpeg / ffprobe
ClipBay does **not** bundle ffmpeg. It calls an `ffmpeg`/`ffprobe` binary that is
already installed on the user's system (e.g. via `winget install Gyan.FFmpeg`).
ffmpeg is licensed under the LGPL or GPL depending on the build. https://ffmpeg.org

> **Note for redistributors / commercial builds:** If you ever package and ship an
> ffmpeg binary together with ClipBay, you must comply with that build's license.
> The common Gyan/winget build is **GPL** (includes x264 etc.), which would impose
> GPL obligations on a bundled product. For a closed-source distribution, ship an
> **LGPL** ffmpeg build (without GPL-only codecs) and include attribution, or keep
> the current approach of requiring the user to install ffmpeg themselves.
