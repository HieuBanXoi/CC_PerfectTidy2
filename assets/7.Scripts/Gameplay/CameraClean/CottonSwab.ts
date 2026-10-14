import { _decorator, Node, UIOpacity } from 'cc';
import { CameraCleanTool } from './CameraCleanTool';

const { ccclass, property } = _decorator;

/**
 * Bước 3: cotton swab lau sạch các vết còn lại trong CleanRegion (sau bước khăn).
 * Đầu bông bẩn dần (dirtyVisual hiện dần theo tiến độ).
 */
@ccclass('CottonSwab')
export class CottonSwab extends CameraCleanTool {
    @property({ min: 1, tooltip: 'Bán kính lau (world).' })
    public swabRadius = 30;

    @property({ type: Node, tooltip: 'Hình bông bẩn (dirty_cotton_swab), hiện dần theo tiến độ lau.' })
    public dirtyVisual: Node | null = null;

    protected onLoad(): void {
        super.onLoad();
        this.setDirty(0);
    }

    /** Độ bẩn tích luỹ từ các lượt trước (lượt sau không làm sạch đầu bông). */
    private _dirtBase = 0;
    private _dirt = 0;

    protected onStepStart(): void {
        this._dirtBase = this._dirt;
        const surface = this.Face?.dirtSurface;
        surface?.Init();
        if (!surface || surface.IsSwabDone) this.scheduleOnce(() => this.finish(), 0);
    }

    protected getHintTarget(): Node | null {
        return this.Face?.dirtSurface?.GetNextRegionNode() ?? null;
    }

    protected onToolDrag(): boolean {
        const surface = this.Face?.dirtSurface;
        if (!surface || !surface.IsNear(this._point, this.swabRadius)) return false;
        surface.PaintBetween(this._lastPoint, this._point, this.swabRadius, true);
        this.setDirty(this._dirtBase + (1 - this._dirtBase) * surface.SwabProgress);
        if (surface.IsSwabDone) this.finish();
        return true;
    }

    private finish(): void {
        this.Face?.dirtSurface?.FinishSwab();
        this.setDirty(1);
        this.Complete();
    }

    private setDirty(progress: number): void {
        // Chỉ bẩn thêm, không bao giờ sạch lại.
        this._dirt = Math.max(this._dirt, Math.max(0, Math.min(1, progress)));
        if (!this.dirtyVisual) return;
        const opacity = this.dirtyVisual.getComponent(UIOpacity) ?? this.dirtyVisual.addComponent(UIOpacity);
        this.dirtyVisual.active = true;
        opacity.opacity = Math.round(this._dirt * 255);
    }
}
