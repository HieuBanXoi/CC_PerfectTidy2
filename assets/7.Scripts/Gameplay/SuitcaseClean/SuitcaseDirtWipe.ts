import { _decorator, Node, tween, UIOpacity } from 'cc';
import { CameraCleanTool } from '../CameraClean/CameraCleanTool';
import { MaskCleanSurface } from '../CameraClean/MaskCleanSurface';

const { ccclass, property } = _decorator;

/**
 * Bước lau vali (tool_1): lau cùng lúc lớp dirty_suitcase và các vết slime.
 * Vết slime chỉ mờ dần tại chỗ cọ quét qua (mỗi lượt quét sạch thêm slimeStrength).
 * Mỗi lớp lau đủ towelCompleteThreshold thì phần sót lại mờ hẳn đi; tất cả các lớp sạch thì xong bước.
 */
@ccclass('SuitcaseDirtWipe')
export class SuitcaseDirtWipe extends CameraCleanTool {
    @property({ type: [MaskCleanSurface], tooltip: 'Lớp bẩn của vali (dirty_suitcase). Sprite cần customMaterial = CleanMat.' })
    public surfaces: MaskCleanSurface[] = [];

    @property({ type: [MaskCleanSurface], tooltip: 'Các vết slime: mờ dần khi lau. Sprite cần customMaterial = CleanMat.' })
    public slimes: MaskCleanSurface[] = [];

    @property({ type: [Node], tooltip: 'Vùng không lau được (CantCleanArea): cọ nằm trong vùng thì không tính là lau. Thêm CleanRegion (towelCleanRatio = 0) vào vùng và gán regionRoot của MaskCleanSurface để mép cọ cũng không lau lấn vào.' })
    public cantCleanAreas: Node[] = [];

    @property({ min: 1, tooltip: 'Bán kính lau (world).' })
    public wipeRadius = 90;

    @property({ min: 0.01, max: 1, step: 0.01, slide: true, tooltip: 'Độ sạch mỗi lần chạm cho lớp bẩn vali. 1 = sạch ngay.' })
    public wipeStrength = 1;

    @property({ min: 0.01, max: 1, step: 0.01, slide: true, tooltip: 'Độ sạch mỗi lượt quét qua vết slime. Nhỏ = phải lau nhiều lượt, slime mờ dần.' })
    public slimeStrength = 0.35;

    @property({ min: 0, tooltip: 'Thời gian (giây) lớp bẩn mờ hẳn khi lau đủ.' })
    public fadeOutDuration = 0.35;

    private readonly _finished = new Set<MaskCleanSurface>();

    protected onStepStart(): void {
        this.allSurfaces.forEach(surface => surface?.Init());
        if (this.isAllDone()) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        return this.allSurfaces.find(surface => surface && !this._finished.has(surface))?.node ?? null;
    }

    protected onToolDrag(): boolean {
        if (this.isInCantCleanArea()) return false;
        let acting = false;
        for (const surface of this.surfaces) {
            if (this.wipe(surface, this.wipeStrength)) acting = true;
        }
        for (const slime of this.slimes) {
            if (this.wipe(slime, this.slimeStrength)) acting = true;
        }
        if (this.isAllDone()) this.Complete();
        return acting;
    }

    private isInCantCleanArea(): boolean {
        return this.cantCleanAreas.some(area => this.isPointInside(this._point, area));
    }

    /** Lau 1 lớp; trả về true nếu cọ đang nằm trên lớp đó. */
    private wipe(surface: MaskCleanSurface, strength: number): boolean {
        if (!surface || this._finished.has(surface) || !surface.IsNear(this._point, this.wipeRadius)) return false;
        surface.PaintBetween(this._lastPoint, this._point, this.wipeRadius, false, strength);
        if (surface.IsTowelDone) this.finish(surface);
        return true;
    }

    private finish(surface: MaskCleanSurface): void {
        this._finished.add(surface);
        const opacity = this.getOpacity(surface);
        tween(opacity)
            .to(this.fadeOutDuration, { opacity: 0 }, { easing: 'sineOut' })
            .call(() => surface.FinishTowel())
            .start();
    }

    private getOpacity(surface: MaskCleanSurface): UIOpacity {
        return surface.getComponent(UIOpacity) ?? surface.addComponent(UIOpacity);
    }

    private get allSurfaces(): MaskCleanSurface[] {
        return [...this.surfaces, ...this.slimes];
    }

    private isAllDone(): boolean {
        return this.allSurfaces.every(surface => !surface || this._finished.has(surface));
    }
}
