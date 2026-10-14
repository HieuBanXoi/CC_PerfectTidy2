import { _decorator, Node } from 'cc';
import { CameraCleanTool } from './CameraCleanTool';

const { ccclass, property } = _decorator;

/**
 * Bước 2: khăn (Tower) lau lớp dirt_and_dust_1 của mặt hiện tại.
 * Trong các CleanRegion khăn chỉ lau tới towelCleanRatio (vết còn mờ cho cotton swab).
 */
@ccclass('ClothWipe')
export class ClothWipe extends CameraCleanTool {
    @property({ min: 1, tooltip: 'Bán kính lau (world).' })
    public wipeRadius = 80;

    @property({ min: 0.01, max: 1, step: 0.01, slide: true, tooltip: 'Độ sạch mỗi lần chạm. 1 = sạch ngay; nhỏ hơn thì phải lau qua lại nhiều lượt (lâu hơn).' })
    public wipeStrength = 1;

    protected onStepStart(): void {
        const surface = this.Face?.dirtSurface;
        surface?.Init();
        if (!surface || surface.IsTowelDone) this.scheduleOnce(() => this.finish(), 0);
    }

    protected getHintTarget(): Node | null {
        return this.Face?.dirtSurface?.node ?? null;
    }

    protected onToolDrag(): boolean {
        const surface = this.Face?.dirtSurface;
        if (!surface || !surface.IsNear(this._point, this.wipeRadius)) return false;
        surface.PaintBetween(this._lastPoint, this._point, this.wipeRadius, false, this.wipeStrength);
        if (surface.IsTowelDone) this.finish();
        return true;
    }

    private finish(): void {
        this.Face?.dirtSurface?.FinishTowel();
        this.Complete();
    }
}
