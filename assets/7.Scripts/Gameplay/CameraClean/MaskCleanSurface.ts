import { _decorator, Component, ImageAsset, Material, Node, Sprite, SpriteFrame, Texture2D, UITransform, Vec3, Vec4, clamp01 } from 'cc';
import { readImagePixels } from '../Matching/ReadImagePixel';
import { CleanRegion, CleanRegionShape } from './CleanRegion';

const { ccclass, property } = _decorator;

/** Pixel được tính là "đã lau" khi giá trị mask đạt ngưỡng này (0..255). */
const TOWEL_CLEAN_VALUE = 230;
const REGION_CLEAN_VALUE = 245;

class RegionState {
    public total = 0;
    public done = 0;
    public finished = false;
    constructor(public readonly region: CleanRegion) { }
    public get Progress(): number {
        return this.total > 0 ? this.done / this.total : 1;
    }
}

/**
 * Lớp bẩn lau bằng mask (dùng material CleanMat: alpha *= 1 - mask).
 * - Layer khăn (towel): lau được tới 100% ngoài vùng, trong CleanRegion chỉ tới towelCleanRatio.
 * - Layer swab: lau được tới 100% mọi nơi; tiến độ swab tính theo từng CleanRegion.
 * Chỉ tính các pixel có hình (alpha của sprite) để % lau sát với vết bẩn thật.
 */
@ccclass('MaskCleanSurface')
export class MaskCleanSurface extends Component {
    @property({ type: Sprite, tooltip: 'Sprite lớp bẩn (cần customMaterial = CleanMat). Để trống: Sprite trên node này.' })
    public targetSprite: Sprite | null = null;

    @property({ type: Node, tooltip: 'Node chứa các CleanRegion (Clean2Range).' })
    public regionRoot: Node | null = null;

    @property({ min: 32, step: 1, tooltip: 'Độ phân giải ngang của mask (chiều dọc tự tính theo tỉ lệ sprite).' })
    public maskWidth = 256;

    @property({ min: 0, max: 1, step: 0.05, tooltip: 'Độ mềm viền nét lau.' })
    public feather = 0.5;

    @property({ min: 0, max: 255, step: 1, tooltip: 'Alpha tối thiểu để pixel được tính là có vết bẩn.' })
    public alphaThreshold = 10;

    @property({ min: 0.1, max: 1, step: 0.05, tooltip: 'Tỉ lệ diện tích (ngoài các vùng) cần lau để xong bước khăn.' })
    public towelCompleteThreshold = 0.85;

    @property({ min: 0.1, max: 1, step: 0.05, tooltip: 'Tỉ lệ diện tích mỗi vùng cần lau bằng swab để vùng đó xong.' })
    public regionCompleteThreshold = 0.85;

    private _w = 0;
    private _h = 0;
    private _buffer: Uint8Array = new Uint8Array(0);
    private _valid: Uint8Array = new Uint8Array(0);
    private _regionOf: Int16Array = new Int16Array(0);
    private _cap: Uint8Array = new Uint8Array(0);
    private _texture: Texture2D | null = null;
    private _material: Material | null = null;
    private readonly _maskUVRect = new Vec4(-1, -1, -1, -1);
    private _dirty = false;
    private _initialized = false;
    private _analyzed = false;
    private _towelTotal = 0;
    private _towelDone = 0;
    private _regions: RegionState[] = [];
    private readonly _tempLocal = new Vec3();
    private readonly _lerp = new Vec3();

    protected onLoad(): void {
        this.Init();
    }

    protected lateUpdate(): void {
        this.syncMaskUVRect();
        if (!this._dirty || !this._texture) return;
        this._texture.uploadData(this._buffer);
        this._dirty = false;
    }

    public Init(): void {
        if (this._initialized) return;
        this.targetSprite ??= this.getComponent(Sprite);
        const transform = this.getTransform();
        if (!this.targetSprite || !transform || transform.width <= 0 || transform.height <= 0) return;
        this._initialized = true;

        this._w = Math.round(this.maskWidth);
        this._h = Math.max(16, Math.round(this._w * transform.height / transform.width));
        const total = this._w * this._h;
        this._buffer = new Uint8Array(total * 4);
        for (let i = 3; i < this._buffer.length; i += 4) this._buffer[i] = 255;
        this._valid = new Uint8Array(total);
        this._regionOf = new Int16Array(total).fill(-1);
        this._cap = new Uint8Array(total).fill(255);
        // Texture phải gán ngay: mặc định cleanMask = white sẽ làm lớp bẩn trong suốt.
        this.createTexture();
    }

    /**
     * Phân tích vùng + alpha + tổng pixel. Làm trễ tới lần dùng đầu tiên để transform
     * của sprite và các CleanRegion đã ổn định (tránh NaN khi scene vừa load).
     */
    private ensureAnalyzed(): boolean {
        this.Init();
        if (!this._initialized) return false;
        if (this._analyzed) return true;
        const transform = this.getTransform()!;
        this._analyzed = true;
        this.buildRegions(transform);
        this.buildValidMask();
        this.countTotals();
        return true;
    }

    // ---------------- Public API ----------------

    /**
     * Lau theo đoạn thẳng (tránh đứt nét khi kéo nhanh). swab = true: lớp lau sạch hẳn.
     * strength = 1: lau sạch ngay trong vùng cọ.
     * strength < 1: độ sạch thêm vào mỗi khi cọ quét QUA một điểm (tính theo quãng đường cọ đi,
     * không theo số frame), ví dụ 0.35 ≈ 3 lượt quét mới sạch. Cọ đứng yên thì không lau thêm.
     */
    public PaintBetween(fromWorld: Vec3, toWorld: Vec3, worldRadius: number, swab: boolean, strength = 1): void {
        if (!this.ensureAnalyzed()) return;
        const distance = Vec3.distance(fromWorld, toWorld);
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, worldRadius * 0.3)));

        if (strength >= 1) {
            for (let i = 0; i <= steps; i++) {
                Vec3.lerp(this._lerp, fromWorld, toWorld, i / steps);
                this.Paint(this._lerp, worldRadius, swab, 1);
            }
            return;
        }

        if (distance < 0.5) return;
        // Một lượt quét qua 1 điểm dài khoảng 2 * bán kính: chia strength theo đoạn đường mỗi bước.
        const stampStrength = strength * (distance / steps) / Math.max(1, worldRadius * 2);
        for (let i = 1; i <= steps; i++) {
            Vec3.lerp(this._lerp, fromWorld, toWorld, i / steps);
            this.Paint(this._lerp, worldRadius, swab, stampStrength);
        }
    }

    public Paint(worldPos: Vec3, worldRadius: number, swab: boolean, strength = 1): void {
        if (!this.ensureAnalyzed()) return;
        const transform = this.getTransform()!;
        const scale = Math.max(0.0001, Math.abs(this.node.worldScale.x));
        transform.convertToNodeSpaceAR(worldPos, this._tempLocal);
        const u = (this._tempLocal.x + transform.anchorX * transform.width) / transform.width;
        const v = (this._tempLocal.y + transform.anchorY * transform.height) / transform.height;
        const cx = u * this._w;
        const cy = (1 - v) * this._h;
        const r = worldRadius / scale / transform.width * this._w;
        if (cx < -r || cy < -r || cx > this._w + r || cy > this._h + r) return;

        const inner = r * (1 - this.feather);
        const minX = Math.max(0, Math.floor(cx - r));
        const maxX = Math.min(this._w - 1, Math.ceil(cx + r));
        const minY = Math.max(0, Math.floor(cy - r));
        const maxY = Math.min(this._h - 1, Math.ceil(cy + r));
        const touchedRegions = new Set<number>();

        for (let y = minY; y <= maxY; y++) {
            const dy = y + 0.5 - cy;
            for (let x = minX; x <= maxX; x++) {
                const dx = x + 0.5 - cx;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > r) continue;
                const falloff = dist <= inner ? 1 : clamp01(1 - (dist - inner) / Math.max(0.0001, r - inner));
                if (falloff <= 0) continue;
                const index = y * this._w + x;
                const old = this._buffer[index * 4];
                let target = strength >= 1
                    ? Math.round(falloff * 255)
                    : Math.min(255, old + Math.max(1, Math.round(falloff * 255 * strength)));
                if (!swab) target = Math.min(target, this._cap[index]);
                if (target <= old) continue;
                this.setPixel(index, target);
                this.trackChange(index, old, target);
                const region = this._regionOf[index];
                if (region >= 0) touchedRegions.add(region);
            }
        }

        for (const regionIndex of touchedRegions) this.checkRegionFinished(regionIndex);
    }

    /** Điểm world có nằm trên (hoặc gần) lớp bẩn không. */
    public IsNear(worldPos: Vec3, worldPadding = 0): boolean {
        const transform = this.getTransform();
        if (!transform || !this.node.activeInHierarchy) return false;
        const scale = Math.max(0.0001, Math.abs(this.node.worldScale.x));
        const pad = worldPadding / scale;
        transform.convertToNodeSpaceAR(worldPos, this._tempLocal);
        const left = -transform.anchorX * transform.width - pad;
        const bottom = -transform.anchorY * transform.height - pad;
        return this._tempLocal.x >= left && this._tempLocal.x <= left + transform.width + pad * 2
            && this._tempLocal.y >= bottom && this._tempLocal.y <= bottom + transform.height + pad * 2;
    }

    public get TowelProgress(): number {
        this.ensureAnalyzed();
        return this._towelTotal > 0 ? this._towelDone / this._towelTotal : 1;
    }

    public get IsTowelDone(): boolean {
        return this.TowelProgress >= this.towelCompleteThreshold;
    }

    /** Tiến độ swab trung bình của các vùng (0..1). */
    public get SwabProgress(): number {
        this.ensureAnalyzed();
        if (this._regions.length === 0) return 1;
        return this._regions.reduce((sum, r) => sum + (r.finished ? 1 : r.Progress), 0) / this._regions.length;
    }

    public get IsSwabDone(): boolean {
        this.ensureAnalyzed();
        return this._regions.every(r => r.finished);
    }

    /** Vùng đầu tiên chưa lau sạch (cho HandTut). */
    public GetNextRegionNode(): Node | null {
        this.ensureAnalyzed();
        return this._regions.find(r => !r.finished)?.region.node ?? null;
    }

    /** Hoàn tất bước khăn: ngoài vùng sạch hẳn, trong vùng lên đúng mức towelCleanRatio. */
    public FinishTowel(): void {
        if (!this.ensureAnalyzed()) return;
        for (let i = 0; i < this._regionOf.length; i++) {
            const old = this._buffer[i * 4];
            const target = this._cap[i];
            if (target <= old) continue;
            this.setPixel(i, target);
            this.trackChange(i, old, target);
        }
        this._towelDone = this._towelTotal;
    }

    /** Hoàn tất bước swab: toàn bộ lớp bẩn sạch hẳn. */
    public FinishSwab(): void {
        for (let i = 0; i < this._regionOf.length; i++) this.setPixel(i, 255);
        this._regions.forEach(r => { r.finished = true; r.done = r.total; });
    }

    // ---------------- Internals ----------------

    /**
     * Sprite nhỏ có thể bị gộp vào atlas (dynamic atlas lúc chạy) nên UV của shader là UV trong atlas.
     * Truyền khung UV của sprite cho shader (maskUVRect) để mask vẫn khớp đúng chỗ lau.
     */
    private syncMaskUVRect(): void {
        const uv = this.targetSprite?.spriteFrame?.uv;
        if (!this._material || !uv || uv.length < 8) return;
        let minU = uv[0], maxU = uv[0], minV = uv[1], maxV = uv[1];
        for (let i = 2; i < 8; i += 2) {
            minU = Math.min(minU, uv[i]);
            maxU = Math.max(maxU, uv[i]);
            minV = Math.min(minV, uv[i + 1]);
            maxV = Math.max(maxV, uv[i + 1]);
        }
        const rect = this._maskUVRect;
        if (rect.x === minU && rect.y === minV && rect.z === maxU - minU && rect.w === maxV - minV) return;
        rect.set(minU, minV, Math.max(0.000001, maxU - minU), Math.max(0.000001, maxV - minV));
        this._material.setProperty('maskUVRect', rect);
    }

    private getTransform(): UITransform | null {
        return (this.targetSprite ?? this.getComponent(Sprite))?.getComponent(UITransform) ?? this.getComponent(UITransform);
    }

    private setPixel(index: number, value: number): void {
        const o = index * 4;
        this._buffer[o] = value;
        this._buffer[o + 1] = value;
        this._buffer[o + 2] = value;
        this._dirty = true;
    }

    private trackChange(index: number, oldValue: number, newValue: number): void {
        if (!this._valid[index]) return;
        const region = this._regionOf[index];
        if (region < 0) {
            if (oldValue < TOWEL_CLEAN_VALUE && newValue >= TOWEL_CLEAN_VALUE) this._towelDone++;
        } else if (oldValue < REGION_CLEAN_VALUE && newValue >= REGION_CLEAN_VALUE) {
            this._regions[region].done++;
        }
    }

    private checkRegionFinished(regionIndex: number): void {
        const state = this._regions[regionIndex];
        if (!state || state.finished || state.Progress < this.regionCompleteThreshold) return;
        state.finished = true;
        // Vùng đạt ngưỡng thì lau sạch hẳn phần còn lại cho gọn.
        for (let i = 0; i < this._regionOf.length; i++) {
            if (this._regionOf[i] === regionIndex) this.setPixel(i, 255);
        }
        state.done = state.total;
    }

    private buildRegions(transform: UITransform): void {
        const regions = this.regionRoot?.getComponentsInChildren(CleanRegion) ?? [];
        this._regions = regions.map(region => new RegionState(region));
        const spriteScale = Math.max(0.0001, Math.abs(this.node.worldScale.x));

        regions.forEach((region, regionIndex) => {
            const regionTransform = region.getComponent(UITransform);
            if (!regionTransform) return;
            // Tâm và nửa kích thước vùng trong toạ độ local của sprite (giả định không xoay).
            transform.convertToNodeSpaceAR(region.node.worldPosition, this._tempLocal);
            const regionScaleX = Math.abs(region.node.worldScale.x) / spriteScale;
            const regionScaleY = Math.abs(region.node.worldScale.y) / spriteScale;
            const halfW = regionTransform.width * regionScaleX * 0.5;
            const halfH = regionTransform.height * regionScaleY * 0.5;
            const centerX = this._tempLocal.x + (0.5 - regionTransform.anchorX) * regionTransform.width * regionScaleX;
            const centerY = this._tempLocal.y + (0.5 - regionTransform.anchorY) * regionTransform.height * regionScaleY;
            const cap = Math.round(clamp01(region.towelCleanRatio) * 255);
            if (![centerX, centerY, halfW, halfH].every(Number.isFinite)) {
                console.warn(`[MaskCleanSurface] Bỏ qua vùng "${region.node.name}" (kích thước không hợp lệ).`);
                return;
            }

            for (let y = 0; y < this._h; y++) {
                const ly = (1 - (y + 0.5) / this._h) * transform.height - transform.anchorY * transform.height;
                const ny = (ly - centerY) / Math.max(0.0001, halfH);
                if (Math.abs(ny) > 1) continue;
                for (let x = 0; x < this._w; x++) {
                    const lx = (x + 0.5) / this._w * transform.width - transform.anchorX * transform.width;
                    const nx = (lx - centerX) / Math.max(0.0001, halfW);
                    if (Math.abs(nx) > 1) continue;
                    if (region.shape === CleanRegionShape.Oval && nx * nx + ny * ny > 1) continue;
                    const index = y * this._w + x;
                    this._regionOf[index] = regionIndex;
                    this._cap[index] = cap;
                }
            }
        });
    }

    private buildValidMask(): void {
        const frame = this.targetSprite?.spriteFrame ?? null;
        // Sprite đã bị gộp vào dynamic atlas: đọc alpha từ texture gốc (rect gốc nằm ở original._x/_y).
        const original = frame?.original as { _texture: Texture2D; _x: number; _y: number } | null | undefined;
        const texture = (original?._texture ?? frame?.texture) as Texture2D | undefined;
        const pixels = texture ? this.readPixels(texture) : null;
        const rectX = original ? original._x : frame?.rect.x ?? 0;
        const rectY = original ? original._y : frame?.rect.y ?? 0;
        for (let y = 0; y < this._h; y++) {
            for (let x = 0; x < this._w; x++) {
                const index = y * this._w + x;
                if (!pixels || !frame || !texture) {
                    this._valid[index] = 1;
                    continue;
                }
                const u = (x + 0.5) / this._w;
                const vTop = (y + 0.5) / this._h;
                const rect = frame.rect;
                const px = frame.rotated
                    ? Math.floor(rectX + vTop * rect.height)
                    : Math.floor(rectX + u * rect.width);
                const py = frame.rotated
                    ? Math.floor(rectY + (1 - u) * rect.width)
                    : Math.floor(rectY + vTop * rect.height);
                const alpha = pixels[(py * texture.width + px) * 4 + 3] ?? 0;
                this._valid[index] = alpha >= this.alphaThreshold ? 1 : 0;
            }
        }
    }

    private readPixels(texture: Texture2D): Uint8ClampedArray | null {
        try {
            const image = texture.image;
            return image ? readImagePixels(image) : null;
        } catch (error) {
            console.warn(`[MaskCleanSurface] Không đọc được alpha của "${this.node.name}", tính toàn bộ hình chữ nhật.`, error);
            return null;
        }
    }

    private countTotals(): void {
        this._towelTotal = 0;
        this._towelDone = 0;
        for (let i = 0; i < this._valid.length; i++) {
            if (!this._valid[i]) continue;
            const region = this._regionOf[i];
            if (region < 0) this._towelTotal++;
            else this._regions[region].total++;
        }
        // Vùng không có pixel bẩn nào thì coi như đã sạch.
        this._regions.forEach(r => { if (r.total === 0) r.finished = true; });
    }

    private createTexture(): void {
        const image = new ImageAsset({
            _data: this._buffer,
            _compressed: false,
            width: this._w,
            height: this._h,
            format: Texture2D.PixelFormat.RGBA8888,
        });
        this._texture = new Texture2D();
        this._texture.image = image;
        const material = this.targetSprite?.getMaterialInstance(0) ?? null;
        this._material = material;
        if (material) {
            material.setProperty('cleanMask', this._texture);
            this.syncMaskUVRect();
        } else {
            console.warn(`[MaskCleanSurface] "${this.node.name}" chưa có customMaterial (CleanMat).`);
        }
    }
}
