'use strict';

const fs = require('fs');
const path = require('path');
const template = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');

module.exports = Editor.Panel.define({
  template,
  style,
  $: { scan: '#scan-button', selectAll: '#select-all-button', selectNone: '#select-none-button', convert: '#convert-button', bitrate: '#bitrate', status: '#status', summary: '#summary', results: '#results' },
  ready() {
    this.state = { files: [], busy: false };
    this.$.scan.addEventListener('confirm', () => void scan.call(this));
    this.$.selectAll.addEventListener('confirm', () => { setAll.call(this, true); });
    this.$.selectNone.addEventListener('confirm', () => { setAll.call(this, false); });
    this.$.convert.addEventListener('confirm', () => void convert.call(this));
  },
});

async function scan() {
  if (this.state.busy) return;
  this.state.busy = true; setStatus.call(this, 'Đang quét assets/...');
  try {
    this.state.files = await Editor.Message.request('audio-mp3-converter', 'scan-audio');
    render.call(this);
    const total = this.state.files.reduce((sum, file) => sum + file.size, 0);
    this.$.summary.textContent = `Tìm thấy ${this.state.files.length} file không phải MP3 (${formatBytes(total)}).`;
    setStatus.call(this, 'Quét xong');
  } catch (error) { setStatus.call(this, error.message || String(error)); }
  finally { this.state.busy = false; }
}

function setAll(checked) { for (const file of this.state.files) file.selected = checked; render.call(this); }

async function convert() {
  if (this.state.busy) return;
  const selected = this.state.files.filter((file) => file.selected);
  if (!selected.length) { setStatus.call(this, 'Hãy chọn ít nhất một file.'); return; }
  const conflicts = selected.filter((file) => file.targetExists).length;
  const message = conflicts
    ? `${conflicts} MP3 cùng tên sẽ bị ghi đè. File gốc không phải MP3 sẽ bị xoá. Tiếp tục?`
    : `${selected.length} file gốc sẽ được thay bằng MP3. Tiếp tục?`;
  if (!window.confirm(message)) return;
  this.state.busy = true; setStatus.call(this, `Đang chuyển ${selected.length} file...`);
  try {
    const report = await Editor.Message.request('audio-mp3-converter', 'convert-audio', { relativePaths: selected.map((file) => file.relativePath), bitrate: this.$.bitrate.value });
    const succeeded = report.filter((item) => item.ok).length;
    const failed = report.filter((item) => !item.ok);
    this.$.summary.textContent = `Hoàn tất: ${succeeded}/${report.length} file đã chuyển. ${failed.length ? `Lỗi: ${failed.map((item) => item.relativePath).join(', ')}` : ''}`;
    setStatus.call(this, failed.length ? 'Hoàn tất, có lỗi' : 'Hoàn tất');
    this.state.busy = false;
    await scan.call(this);
  } catch (error) { setStatus.call(this, error.message || String(error)); }
  finally { this.state.busy = false; }
}

function render() {
  if (!this.state.files.length) { this.$.results.className = 'results empty'; this.$.results.textContent = 'Không tìm thấy WAV, OGG, FLAC, AAC, M4A hoặc WMA trong assets/.'; return; }
  this.$.results.className = 'results';
  this.$.results.innerHTML = `<table class="audio-table"><thead><tr><th><input id="toggle-all" type="checkbox"></th><th>File nguồn</th><th>MP3 đích</th><th>Dung lượng</th></tr></thead><tbody>${this.state.files.map((file, index) => `<tr><td><input class="file-toggle" data-index="${index}" type="checkbox" ${file.selected ? 'checked' : ''}></td><td class="path">${escapeHtml(file.relativePath)}</td><td class="path ${file.targetExists ? 'conflict' : ''}">${escapeHtml(file.targetRelativePath)}${file.targetExists ? ' (sẽ ghi đè)' : ''}</td><td class="size">${formatBytes(file.size)}</td></tr>`).join('')}</tbody></table>`;
  this.$.results.querySelector('#toggle-all').addEventListener('change', (event) => setAll.call(this, event.target.checked));
  for (const toggle of this.$.results.querySelectorAll('.file-toggle')) toggle.addEventListener('change', (event) => { this.state.files[Number(event.target.dataset.index)].selected = event.target.checked; });
}

function setStatus(value) { this.$.status.textContent = value; }
function formatBytes(value) { return value >= 1048576 ? `${(value / 1048576).toFixed(2)} MB` : `${Math.ceil(value / 1024)} KB`; }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
