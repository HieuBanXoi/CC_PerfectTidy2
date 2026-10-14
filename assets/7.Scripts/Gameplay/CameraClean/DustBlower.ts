import { _decorator, Node, UIOpacity } from 'cc';
import { CameraCleanTool } from './CameraCleanTool';

const { ccclass, property } = _decorator;

/**
 * Bước 4: bóp quả thổi bụi vào kính (dust_on camera_glass) cho bụi mờ dần về 0.
 * Khi đang thổi, hình quả bóp đổi qua lại giữa normal / squeezed.
 */
@ccclass('DustBlower')
export class DustBlower extends CameraCleanTool {
    @property({ min: 0.1, tooltip: 'Tổng thời gian thổi trúng để bụi mờ hết (giây).' })
    public requiredBlowTime = 1.5;

    @property({ min: 0, tooltip: 'Nới rộng vùng bụi khi kiểm tra thổi trúng (world).' })
    public blowPadding = 40;

    @property({ type: Node, tooltip: 'Hình quả bóp bình thường (dust_blower-001).' })
    public normalVisual: Node | null = null;

    @property({ type: Node, tooltip: 'Hình quả bóp đang bóp (dust_blower2).' })
    public squeezedVisual: Node | null = null;

    @property({ min: 0.02, tooltip: 'Chu kỳ đổi hình bóp / thả (giây).' })
    public squeezeInterval = 0.12;

    private _squeezeTimer = 0;
    private _isSqueezed = false;

    protected onLoad(): void {
        super.onLoad();
        this.setSqueezed(false);
    }

    protected onStepStart(): void {
        const dust = this.Face?.glassDust;
        if (!dust || !dust.activeInHierarchy) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        const dust = this.Face?.glassDust;
        return dust?.activeInHierarchy ? dust : null;
    }

    protected onToolDrag(dt: number): boolean {
        const dust = this.Face?.glassDust;
        if (!dust || !this.isPointInside(this._point, dust, this.blowPadding)) {
            this.setSqueezed(false);
            return false;
        }

        this._squeezeTimer += dt;
        if (this._squeezeTimer >= this.squeezeInterval) {
            this._squeezeTimer = 0;
            this.setSqueezed(!this._isSqueezed);
        }

        const opacity = dust.getComponent(UIOpacity) ?? dust.addComponent(UIOpacity);
        opacity.opacity = Math.max(0, opacity.opacity - 255 * dt / this.requiredBlowTime);
        if (opacity.opacity <= 0) {
            dust.active = false;
            this.setSqueezed(false);
            this.Complete();
        }
        return true;
    }

    protected onToolDragEnd(): void {
        this.setSqueezed(false);
    }

    private setSqueezed(squeezed: boolean): void {
        this._isSqueezed = squeezed;
        if (this.normalVisual) this.normalVisual.active = !squeezed;
        if (this.squeezedVisual) this.squeezedVisual.active = squeezed;
    }
}
