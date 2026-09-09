"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_EXTENSIONS = void 0;
exports.collectWebMobileFiles = collectWebMobileFiles;
exports.getPlayableEnginePath = getPlayableEnginePath;
exports.generateChannelZipJs = generateChannelZipJs;
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
// @ts-ignore
const AdmZip = require("adm-zip");
const channels_1 = require("./channels");
exports.FILE_EXTENSIONS = {
    // .html/.css được đọc & patch riêng (không đóng vào zip asset)
    EXCLUDE: ['.html', '.css'],
    IMAGE: ['.png', '.jpg', '.jpeg'],
    AUDIO: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
};
let sharpLib = null;
try {
    // sharp là native module: có thể build lệch ABI với Electron của Cocos Creator Editor.
    // Nếu load lỗi, tự động fallback dùng file ảnh gốc (không nén) thay vì làm sập cả build.
    sharpLib = require('sharp');
}
catch (err) {
    console.warn('[playable-ads-builder] Không load được "sharp", ảnh sẽ giữ nguyên (không nén webp).', err);
}
let ffmpegLib = null;
try {
    ffmpegLib = require('fluent-ffmpeg');
    const ffmpegStaticPath = require('ffmpeg-static');
    if (ffmpegStaticPath) {
        ffmpegLib.setFfmpegPath(ffmpegStaticPath);
    }
}
catch (err) {
    console.warn('[playable-ads-builder] Không load được "fluent-ffmpeg"/"ffmpeg-static", audio sẽ giữ nguyên (không nén mp3).', err);
}
async function compressImage(filePath, compression) {
    const raw = await fs.readFile(filePath);
    if (!sharpLib || compression.type === channels_1.CompressionType.None) {
        return raw;
    }
    try {
        const options = compression.type === channels_1.CompressionType.Lossless ? { lossless: true } : { quality: compression.quality };
        const compressed = await sharpLib(filePath).webp(options).toBuffer();
        return compressed.length < raw.length ? compressed : raw;
    }
    catch (err) {
        console.warn(`[playable-ads-builder] Nén ảnh thất bại, dùng ảnh gốc: ${filePath}`, err);
        return raw;
    }
}
async function compressAudio(filePath, tempDir, bitrate) {
    if (!ffmpegLib) {
        return { relativeExt: path.extname(filePath), data: await fs.readFile(filePath) };
    }
    try {
        await fs.ensureDir(tempDir);
        const outFile = path.join(tempDir, `${path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')}_${Date.now()}_${Math.round(Math.random() * 1e6)}.mp3`);
        await new Promise((resolve, reject) => {
            ffmpegLib(filePath).audioBitrate(bitrate).toFormat('mp3').on('error', reject).on('end', () => resolve()).save(outFile);
        });
        return { relativeExt: '.mp3', data: await fs.readFile(outFile) };
    }
    catch (err) {
        console.warn(`[playable-ads-builder] Nén audio thất bại, dùng file gốc: ${filePath}`, err);
        return { relativeExt: path.extname(filePath), data: await fs.readFile(filePath) };
    }
}
/** Duyệt đệ quy thư mục web-mobile output, nén ảnh/audio theo cấu hình, trả về danh sách file sẽ đóng vào zip */
async function walk(dir, root, compression, audio, tempDir) {
    const entries = await fs.readdir(dir);
    const results = await Promise.all(entries.map(async (entry) => {
        const full = path.join(dir, entry);
        if ((await fs.stat(full)).isDirectory()) {
            return walk(full, root, compression, audio, tempDir);
        }
        const ext = path.extname(full).toLowerCase();
        const relPath = path.relative(root, full).replace(/\\/g, '/');
        if (exports.FILE_EXTENSIONS.EXCLUDE.includes(ext)) {
            return null;
        }
        if (exports.FILE_EXTENSIONS.IMAGE.includes(ext)) {
            return { path: relPath, data: await compressImage(full, compression) };
        }
        if (exports.FILE_EXTENSIONS.AUDIO.includes(ext) && audio.enabled) {
            const { relativeExt, data } = await compressAudio(full, path.join(tempDir, '_audioCompressed'), audio.bitrate);
            const newRelPath = relativeExt === ext ? relPath : `${relPath.slice(0, -ext.length)}${relativeExt}`;
            return { path: newRelPath, data };
        }
        return { path: relPath, data: await fs.readFile(full) };
    }));
    return results.flat().filter((f) => f !== null);
}
async function collectWebMobileFiles(webMobileDir, compression, audio, tempDir) {
    return walk(webMobileDir, webMobileDir, compression, audio, tempDir);
}
// --- base122: mã hoá gọn cho các kênh nhúng zip.js trực tiếp vào <script> inline (không zip riêng) ---
const BASE122_ILLEGAL_BYTES = [0, 10, 13, 34, 38, 92, 60];
function base122Encode(input) {
    let byteIndex = 0;
    let bitOffset = 0;
    const out = [];
    function nextSeptet() {
        if (byteIndex >= input.length) {
            return false;
        }
        let value = (254 >>> bitOffset & input[byteIndex]) << bitOffset;
        value >>= 1;
        bitOffset += 7;
        if (bitOffset < 8) {
            return value;
        }
        bitOffset -= 8;
        byteIndex++;
        if (byteIndex >= input.length) {
            return value;
        }
        let extra = 65280 >>> bitOffset & input[byteIndex] & 255;
        extra >>= 8 - bitOffset;
        return value | extra;
    }
    while (true) {
        const septet = nextSeptet();
        if (septet === false) {
            break;
        }
        const illegalIndex = BASE122_ILLEGAL_BYTES.indexOf(septet);
        if (illegalIndex !== -1) {
            let next = nextSeptet();
            let lead = 194;
            if (next === false) {
                lead |= 28;
                next = septet;
            }
            else {
                lead |= (illegalIndex & 7) << 2;
            }
            lead |= (next & 64) > 0 ? 1 : 0;
            const trail = next & 63 | 128;
            out.push(lead);
            out.push(trail);
        }
        else {
            out.push(septet);
        }
    }
    return Buffer.from(out);
}
function getPlayableEnginePath() {
    return path.join(__dirname, '..', 'playable-engine');
}
async function getChannelSdkScript(channel, product) {
    if (!Object.values(channels_1.CHANNEL).includes(channel)) {
        throw new Error(`Kênh "${channel}" không hợp lệ.`);
    }
    const sdkPath = path.join(getPlayableEnginePath(), 'channels', `${channel}.js`);
    let content = await fs.readFile(sdkPath, 'utf-8');
    // Format thật trong channels/*.js là `google_url: "",` (key không nháy, value nháy kép),
    // KHÔNG phải `'google_url':''` như code gốc PlayableBuilder giả định - regex cũ không bao
    // giờ khớp nên link luôn bị để trống dù đã điền trong panel Build. Dùng hàm thay thế (không
    // phải chuỗi template trực tiếp) để tránh URL chứa ký tự "$" bị hiểu nhầm thành pattern đặc
    // biệt của String.replace.
    content = content.replace(/google_url:\s*""/, () => `google_url: "${product.googleUrl}"`);
    content = content.replace(/apple_url:\s*""/, () => `apple_url: "${product.appleUrl}"`);
    return content;
}
/**
 * Với mỗi channel: đóng gói asset đã nén + BingoEngine.js + PlayableSDK.js (adapter riêng kênh)
 * thành 1 zip, encode base64/base122, ghi ra `${channel}.zip.js` trong `tempDir`.
 */
async function generateChannelZipJs(files, channels, product, tempDir, onProgress) {
    await fs.ensureDir(tempDir);
    const bingoEngineContent = await fs.readFile(path.join(getPlayableEnginePath(), 'BingoEngine.js'), 'utf-8');
    let done = 0;
    for (const channel of channels) {
        const zip = new AdmZip();
        for (const f of files) {
            zip.addFile(f.path, f.data);
        }
        zip.addFile('BingoEngine.js', Buffer.from(bingoEngineContent, 'utf-8'));
        const sdkScript = await getChannelSdkScript(channel, product);
        zip.addFile('PlayableSDK.js', Buffer.from(sdkScript, 'utf-8'));
        const zipBuffer = zip.toBuffer();
        const useBase64 = channels_1.CHANNELS_REQUIRING_ZIP.includes(channel);
        const encoded = useBase64 ? zipBuffer.toString('base64') : base122Encode(zipBuffer).toString('utf-8');
        const jsContent = useBase64
            ? `window.__zipEncoding="base64";window.__zip=${JSON.stringify(encoded)};`
            : `window.__zipEncoding="base122";window.__zip="${encoded}";`;
        await fs.writeFile(path.join(tempDir, `${channel}.zip.js`), jsContent, 'utf-8');
        done++;
        onProgress?.(done, channels.length);
    }
}
