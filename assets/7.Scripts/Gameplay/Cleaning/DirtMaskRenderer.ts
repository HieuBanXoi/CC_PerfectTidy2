import { _decorator, Component, Sprite, Texture2D, ImageAsset, clamp01, Material } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('DirtMaskRenderer')
export class DirtMaskRenderer extends Component {
    @property({ type: Sprite, tooltip: 'Sprite mạng nhện cần áp dụng Mask' })
    public targetSprite: Sprite = null!;

    @property({ tooltip: 'Độ phân giải chiều rộng mask texture' })
    public maskWidth: number = 256;

    @property({ tooltip: 'Độ phân giải chiều cao mask texture' })
    public maskHeight: number = 256;

    @property({ tooltip: 'Độ mềm viền cọ (0 = nét cứng, 0.7 = viền mờ mềm mại)' })
    public feather: number = 0.5;

    private _maskBuffer!: Uint8Array;
    private _pixelPass!: Uint8Array;        // số lần chổi đã đi qua từng pixel
    private _pixelLastStep!: Int32Array;    // step gần nhất pixel nằm dưới chổi (để phát hiện "đi vào")
    private _maskTexture!: Texture2D;
    private _customMaterial: Material = null!;
    private _isDirty: boolean = false;

    onLoad() {
        this.initMaskTexture();
    }

    private initMaskTexture() {
        const totalPixels = this.maskWidth * this.maskHeight;
        // RGBA buffer (4 bytes mỗi pixel)
        this._maskBuffer = new Uint8Array(totalPixels * 4);
        this._maskBuffer.fill(0); // 0 = đen = chưa quét (alpha giữ nguyên)
        this._pixelPass = new Uint8Array(totalPixels);
        this._pixelLastStep = new Int32Array(totalPixels);
        this._pixelLastStep.fill(-10);

        const image = new ImageAsset({
            _data: this._maskBuffer,
            _compressed: false,
            width: this.maskWidth,
            height: this.maskHeight,
            format: Texture2D.PixelFormat.RGBA8888,
        });

        this._maskTexture = new Texture2D();
        this._maskTexture.image = image;

        // Gán mask texture vào material của targetSprite
        if (this.targetSprite) {
            this._customMaterial = this.targetSprite.getMaterialInstance(0)!;
            if (this._customMaterial) {
                this._customMaterial.setProperty('cleanMask', this._maskTexture);
            }
        }
    }

    /**
     * Vẽ vết cọ tròn có viền mờ (Soft Feather) tại tọa độ UV [0..1]
     * @param totalPasses Số lần chổi phải đi qua để pixel sạch hẳn (1 = hành vi cũ)
     * @param step Bộ đếm bước quét tăng dần theo mỗi lần gọi. Pixel được tính thêm 1 lần lau khi
     *             nó KHÔNG nằm dưới chổi ở bước ngay trước (chổi rời đi rồi quay lại)
     */
    public drawCircleUV(u: number, v: number, radiusUV: number, totalPasses: number = 1, step: number = 0) {
        const passes = Math.max(1, Math.floor(totalPasses));
        const px = Math.round(u * this.maskWidth);
        const py = Math.round((1.0 - v) * this.maskHeight);
        const radiusPx = Math.max(1, Math.round(radiusUV * this.maskWidth));
        const radiusSq = radiusPx * radiusPx;

        const minX = Math.max(0, px - radiusPx);
        const maxX = Math.min(this.maskWidth - 1, px + radiusPx);
        const minY = Math.max(0, py - radiusPx);
        const maxY = Math.min(this.maskHeight - 1, py + radiusPx);

        const innerRadius = radiusPx * (1.0 - this.feather);

        for (let y = minY; y <= maxY; y++) {
            const dy = y - py;
            const rowOffset = y * this.maskWidth * 4;

            for (let x = minX; x <= maxX; x++) {
                const dx = x - px;
                const distSq = dx * dx + dy * dy;

                if (distSq <= radiusSq) {
                    const pIdx = y * this.maskWidth + x;

                    // Đếm số lần lau: chỉ tăng khi chổi vừa "đi vào" pixel này
                    const entering = this._pixelLastStep[pIdx] !== step - 1;
                    this._pixelLastStep[pIdx] = step;
                    if (entering && this._pixelPass[pIdx] < passes) {
                        this._pixelPass[pIdx]++;
                    }
                    const levelScale = this._pixelPass[pIdx] / passes;

                    const dist = Math.sqrt(distSq);
                    let alpha = 1.0;
                    if (dist > innerRadius) {
                        alpha = 1.0 - (dist - innerRadius) / (radiusPx - innerRadius);
                    }
                    alpha = clamp01(alpha) * levelScale;
                    const byteVal = Math.round(alpha * 255);

                    const idx = rowOffset + (x * 4);
                    // Tích lũy giá trị lớn nhất (vết quét không làm mờ lại vùng đã quét)
                    if (byteVal > this._maskBuffer[idx]) {
                        this._maskBuffer[idx] = byteVal;         // R
                        this._maskBuffer[idx + 1] = byteVal;     // G
                        this._maskBuffer[idx + 2] = byteVal;     // B
                        this._maskBuffer[idx + 3] = 255;         // A
                        this._isDirty = true;
                    }
                }
            }
        }

        this.applyUpdate();
    }

    private applyUpdate() {
        if (!this._isDirty || !this._maskTexture) return;
        this._maskTexture.uploadData(this._maskBuffer);
        this._isDirty = false;
    }

    /**
     * Xóa sạch toàn bộ mạng nhện (khi hoàn thành level)
     */
    public fillAll() {
        this._maskBuffer.fill(255);
        this._pixelPass.fill(255);
        this._isDirty = true;
        this.applyUpdate();
    }

    /**
     * Nâng toàn bộ mask lên tối thiểu mức pass/totalPasses - dùng khi đủ % diện tích đạt lượt lau thứ `pass`
     * để phần chưa lau tới cũng mờ bằng phần đã lau, không làm giảm vùng đã sạch hơn.
     */
    public fillPass(pass: number, totalPasses: number) {
        const passes = Math.max(1, Math.floor(totalPasses));
        const minPass = Math.max(0, Math.min(passes, Math.floor(pass)));
        const byteVal = Math.round(clamp01(minPass / passes) * 255);
        if (byteVal >= 255) {
            this.fillAll();
            return;
        }

        const total = this.maskWidth * this.maskHeight;
        for (let i = 0; i < total; i++) {
            if (this._pixelPass[i] < minPass) this._pixelPass[i] = minPass;
            const idx = i * 4;
            if (byteVal > this._maskBuffer[idx]) {
                this._maskBuffer[idx] = byteVal;
                this._maskBuffer[idx + 1] = byteVal;
                this._maskBuffer[idx + 2] = byteVal;
                this._maskBuffer[idx + 3] = 255;
                this._isDirty = true;
            }
        }
        this.applyUpdate();
    }

    /**
     * Reset mask về trạng thái ban đầu
     */
    public reset() {
        this._maskBuffer.fill(0);
        this._pixelPass.fill(0);
        this._pixelLastStep.fill(-10);
        this._isDirty = true;
        this.applyUpdate();
    }
}
