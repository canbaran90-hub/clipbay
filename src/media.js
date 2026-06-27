// ffmpeg/ffprobe wrappers: probe metadata, generate thumbnails + hover sprites + audio waveform images.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Allow override via env, otherwise rely on PATH (winget shim resolves these).
const FFMPEG = process.env.CLIPBAY_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.CLIPBAY_FFPROBE || 'ffprobe';

const SPRITE_COLS = 5;
const SPRITE_ROWS = 5;
const SPRITE_COUNT = SPRITE_COLS * SPRITE_ROWS;
const SPRITE_TILE_W = 320; // per-frame width inside the sprite sheet

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function hashPath(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

async function probe(filePath) {
  try {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const v = (info.streams || []).find((s) => s.codec_type === 'video');
    const a = (info.streams || []).find((s) => s.codec_type === 'audio');
    const duration = parseFloat(info.format && info.format.duration) || 0;
    return {
      duration,
      width: v ? v.width : null,
      height: v ? v.height : null,
      hasVideo: !!v,
      hasAudio: !!a,
      pixFmt: v ? v.pix_fmt : null,
      vcodec: v ? v.codec_name : null,
    };
  } catch (e) {
    return { duration: 0, width: null, height: null, hasVideo: false, hasAudio: false, pixFmt: null, vcodec: null };
  }
}

// Transparent / intra-frame formats that Chromium can't play and that must keep alpha.
function hasAlpha(meta) {
  const pf = (meta && meta.pixFmt || '').toLowerCase();
  return ['yuva', 'rgba', 'argb', 'abgr', 'bgra', 'gbrap', 'ya8', 'ya16'].some((t) => pf.includes(t));
}

async function makeVideoThumb(filePath, outPath, duration) {
  const ss = duration > 1 ? Math.min(duration / 2, duration - 0.1) : 0;
  await run(FFMPEG, [
    '-y', '-ss', String(ss), '-i', filePath,
    '-frames:v', '1', '-vf', 'scale=480:-2',
    '-q:v', '4', outPath,
  ]);
}

async function makeVideoSprite(filePath, outPath, duration) {
  // Sample SPRITE_COUNT frames evenly across the clip into one tiled sheet.
  const dur = duration > 0 ? duration : 1;
  const fps = SPRITE_COUNT / dur;
  await run(FFMPEG, [
    '-y', '-i', filePath,
    '-vf', `fps=${fps.toFixed(6)},scale=${SPRITE_TILE_W}:-2,tile=${SPRITE_COLS}x${SPRITE_ROWS}`,
    '-frames:v', '1', '-q:v', '5', outPath,
  ]);
}

async function makeAudioWave(filePath, outPath) {
  await run(FFMPEG, [
    '-y', '-i', filePath,
    '-filter_complex', 'showwavespic=s=480x140:colors=#5b9cff',
    '-frames:v', '1', outPath,
  ]);
}

async function makeImageThumb(filePath, outPath) {
  await run(FFMPEG, [
    '-y', '-i', filePath,
    '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outPath,
  ]);
}

// Trim [inPt, inPt+dur] into outPath.
//  mode 'copy'  -> stream copy (intra-frame/alpha sources: frame-accurate, keeps transparency)
//  mode 'h264'  -> re-encode (long-GOP video: frame-accurate)
//  mode 'audio' -> audio stream copy
async function exportClip(filePath, inPt, dur, outPath, mode) {
  let args;
  if (mode === 'h264') {
    args = ['-y', '-ss', String(inPt), '-i', filePath, '-t', String(dur),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', outPath];
  } else {
    // copy / audio
    args = ['-y', '-ss', String(inPt), '-i', filePath, '-t', String(dur), '-c', 'copy', outPath];
  }
  await run(FFMPEG, args);
  return outPath;
}

// Browser-playable proxy (H.264/yuv420p) for sources Chromium can't decode (ProRes, MXF, alpha .mov…).
// Transparency is flattened onto black — fine for preview/scrubbing. The original stays untouched.
async function makePreviewProxy(filePath, outPath) {
  await run(FFMPEG, [
    '-y', '-i', filePath,
    '-vf', "scale='min(1280,iw)':-2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', outPath,
  ]);
  return outPath;
}

async function ffmpegAvailable() {
  try {
    await run(FFMPEG, ['-version']);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  probe,
  makeVideoThumb,
  makeVideoSprite,
  makeAudioWave,
  makeImageThumb,
  exportClip,
  makePreviewProxy,
  hasAlpha,
  ffmpegAvailable,
  hashPath,
  SPRITE_COLS,
  SPRITE_ROWS,
  SPRITE_COUNT,
};
