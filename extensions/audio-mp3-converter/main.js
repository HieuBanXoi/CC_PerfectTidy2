'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PACKAGE_NAME = 'audio-mp3-converter';
const SUPPORTED_EXTENSIONS = new Set(['.wav', '.flac', '.ogg', '.aac', '.m4a', '.wma']);

exports.methods = {
  openPanel() {
    Editor.Panel.open(PACKAGE_NAME);
  },

  async scanAudio() {
    const assetsRoot = path.join(Editor.Project.path, 'assets');
    const files = await collectAudioFiles(assetsRoot);
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  },

  async convertAudio(payload) {
    const relativePaths = Array.isArray(payload && payload.relativePaths) ? payload.relativePaths : [];
    const bitrate = normalizeBitrate(payload && payload.bitrate);
    if (!relativePaths.length) {
      throw new Error('Chưa chọn file audio nào.');
    }

    const assetsRoot = path.resolve(Editor.Project.path, 'assets');
    const ffmpegPath = findFfmpeg();
    if (!ffmpegPath) {
      throw new Error('Không tìm thấy ffmpeg.exe. Cài FFmpeg vào PATH hoặc giữ playable-size-inspector trong extensions.');
    }

    const sources = [];
    for (const relativePath of [...new Set(relativePaths.map(String))]) {
      const sourcePath = resolveAssetPath(assetsRoot, relativePath);
      const extension = path.extname(sourcePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Định dạng không hỗ trợ: ${relativePath}`);
      }
      await fs.access(sourcePath);
      sources.push({
        sourcePath,
        relativePath: normalizeRelative(relativePath),
        targetPath: sourcePath.slice(0, -extension.length) + '.mp3',
      });
    }

    const targetOwners = new Map();
    for (const source of sources) {
      const key = source.targetPath.toLowerCase();
      if (targetOwners.has(key)) {
        throw new Error(`Không thể chuyển cùng lúc hai file có chung tên MP3: ${source.relativePath} và ${targetOwners.get(key)}.`);
      }
      targetOwners.set(key, source.relativePath);
    }

    const results = [];
    for (const source of sources) {
      try {
        results.push(await convertOne({ ...source, ffmpegPath, bitrate }));
      } catch (error) {
        results.push({ ok: false, relativePath: source.relativePath, error: error.message || String(error) });
      }
    }

    await refreshAssets();
    return results;
  },
};

async function collectAudioFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(fullPath);
        files.push({
          relativePath: normalizeRelative(path.relative(root, fullPath)),
          size: stat.size,
          extension: path.extname(entry.name).toLowerCase(),
          targetRelativePath: normalizeRelative(path.relative(root, fullPath.slice(0, -path.extname(fullPath).length) + '.mp3')),
          targetExists: fssync.existsSync(fullPath.slice(0, -path.extname(fullPath).length) + '.mp3'),
        });
      }
    }
  }
  await walk(root);
  return files;
}

async function convertOne({ sourcePath, targetPath, relativePath, ffmpegPath, bitrate }) {
  const sourceMetaPath = `${sourcePath}.meta`;
  const targetMetaPath = `${targetPath}.meta`;
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.audio-convert-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`);
  const beforeBytes = (await fs.stat(sourcePath)).size;
  const replacedExistingMp3 = await pathExists(targetPath);

  try {
    await runFfmpeg(ffmpegPath, sourcePath, temporaryPath, bitrate);
    const outputStat = await fs.stat(temporaryPath);
    if (!outputStat.size) {
      throw new Error('FFmpeg đã tạo file MP3 rỗng.');
    }

    // Preserve the original asset UUID. Existing target MP3 (if any) is intentionally replaced.
    await fs.rm(targetPath, { force: true });
    await fs.rm(targetMetaPath, { force: true });
    await fs.rename(temporaryPath, targetPath);
    await fs.rm(sourcePath, { force: true });
    if (await pathExists(sourceMetaPath)) {
      await fs.rename(sourceMetaPath, targetMetaPath);
    }

    return {
      ok: true,
      relativePath,
      targetRelativePath: normalizeRelative(path.relative(path.join(Editor.Project.path, 'assets'), targetPath)),
      beforeBytes,
      afterBytes: outputStat.size,
      replacedExistingMp3,
    };
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function runFfmpeg(ffmpegPath, inputPath, outputPath, bitrate) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-b:a', bitrate, outputPath], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr && stderr.trim() ? stderr.trim() : error.message));
        return;
      }
      resolve();
    });
  });
}

function findFfmpeg() {
  const pathCandidate = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundledCandidate = path.join(__dirname, '..', 'playable-size-inspector', 'playable-size-inspector', 'tools', 'ffmpeg', 'ffmpeg.exe');
  if (fssync.existsSync(bundledCandidate)) return bundledCandidate;
  const pathEntries = String(process.env.PATH || '').split(path.delimiter);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, pathCandidate);
    if (fssync.existsSync(candidate)) return candidate;
  }
  return '';
}

function resolveAssetPath(assetsRoot, relativePath) {
  const resolved = path.resolve(assetsRoot, relativePath);
  if (resolved !== assetsRoot && !resolved.startsWith(`${assetsRoot}${path.sep}`)) {
    throw new Error(`Đường dẫn nằm ngoài assets: ${relativePath}`);
  }
  return resolved;
}

function normalizeRelative(value) {
  return String(value).replace(/\\/g, '/');
}

function normalizeBitrate(value) {
  const numeric = Number.parseInt(String(value || '128'), 10);
  return `${Math.max(32, Math.min(320, Number.isFinite(numeric) ? numeric : 128))}k`;
}

async function pathExists(target) {
  try { await fs.access(target); return true; } catch (_error) { return false; }
}

async function refreshAssets() {
  try {
    await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
  } catch (error) {
    console.warn('[audio-mp3-converter] Could not explicitly refresh Asset DB:', error);
  }
}
