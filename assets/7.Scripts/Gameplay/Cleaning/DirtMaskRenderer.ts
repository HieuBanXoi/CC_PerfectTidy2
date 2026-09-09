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
     */
    public drawCircleUV(u: number, v: number, radiusUV: number) {
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
                    const dist = Math.sqrt(distSq);
                    let alpha = 1.0;
                    if (dist > innerRadius) {
                        alpha = 1.0 - (dist - innerRadius) / (radiusPx - innerRadius);
                    }
                    alpha = clamp01(alpha);
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
        this._isDirty = true;
        this.applyUpdate();
    }

    /**
     * Reset mask về trạng thái ban đầu
     */
    public reset() {
        this._maskBuffer.fill(0);
        this._isDirty = true;
        this.applyUpdate();
    }
}
