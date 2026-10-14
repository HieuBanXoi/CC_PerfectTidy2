import { _decorator, Node, ParticleSystem2D } from 'cc';
import { CameraCleanTool } from './CameraCleanTool';
import { WetWipe } from './WetWipe';

const { ccclass, property } = _decorator;

/**
 * Xịt nước lau kính vào giấy ướt (wipe_Main) để làm ướt giấy (giấy sẫm màu dần).
 * Xịt được bất kỳ lúc nào sau khi giấy đã được rút ra, kể cả khi chưa tới lượt.
 * Tới lượt mà giấy đã ướt sẵn thì lượt này tự xong.
 */
@ccclass('GlassCleaner')
export class GlassCleaner extends CameraCleanTool {
    @property({ type: WetWipe, tooltip: 'Giấy cần xịt ướt.' })
    public wetWipe: WetWipe | null = null;

    @property({ min: 0.1, tooltip: 'Tổng thời gian xịt trúng để giấy ướt hẳn (giây).' })
    public requiredSprayTime = 1.0;

    @property({ min: 0, tooltip: 'Nới rộng vùng giấy khi kiểm tra xịt trúng (world).' })
    public sprayPadding = 40;

    @property({ type: [ParticleSystem2D], tooltip: 'Particle tia xịt (tuỳ chọn), bật khi đang xịt trúng.' })
    public sprayParticles: ParticleSystem2D[] = [];

    private _isSpraying = false;

    protected get CanWorkWhenNotCurrent(): boolean {
        return !!this.wetWipe?.CanBeWetted;
    }

    protected onStepStart(): void {
        if (this.wetWipe?.IsFullyWet) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        return this.wetWipe?.node ?? null;
    }

    protected onToolDrag(dt: number): boolean {
        const target = this.wetWipe;
        if (!target || !target.CanBeWetted || !this.isPointInside(this._point, target.node, this.sprayPadding)) {
            this.setSpraying(false);
            return false;
        }
        this.setSpraying(true);
        target.SetWet(target.Wet + dt / this.requiredSprayTime);
        if (target.IsFullyWet) {
            this.setSpraying(false);
            // Chỉ báo xong khi đang là lượt của bình xịt; xịt sớm thì chỉ làm ướt giấy.
            if (this.IsCurrentStep) this.Complete();
            return true;
        }
        return true;
    }

    protected onToolDragEnd(): void {
        this.setSpraying(false);
    }

    private setSpraying(on: boolean): void {
        if (this._isSpraying === on) return;
        this._isSpraying = on;
        for (const particle of this.sprayParticles) {
            if (!particle?.isValid) continue;
            if (on) {
                particle.node.active = true;
                particle.resetSystem();
            } else {
                particle.stopSystem();
            }
        }
    }
}
