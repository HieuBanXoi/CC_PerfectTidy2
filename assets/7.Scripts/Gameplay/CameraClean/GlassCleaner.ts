import { _decorator, Node, ParticleSystem2D, Tween, tween, Enum } from 'cc';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CameraCleanTool } from './CameraCleanTool';
import { WetWipe } from './WetWipe';

const { ccclass, property } = _decorator;

/**
 * Xịt nước lau kính vào giấy ướt (wipe_Main) theo nhịp: mỗi phát (sound spray puff) giấy ướt thêm 1 phần,
 * đủ puffCount phát thì ướt hẳn.
 * Xịt được bất kỳ lúc nào sau khi giấy đã được rút ra, kể cả khi chưa tới lượt.
 * Tới lượt mà giấy đã ướt sẵn thì lượt này tự xong.
 */
@ccclass('GlassCleaner')
export class GlassCleaner extends CameraCleanTool {
    @property({ type: WetWipe, tooltip: 'Giấy cần xịt ướt.' })
    public wetWipe: WetWipe | null = null;

    @property({ min: 1, step: 1, tooltip: 'Số phát xịt để giấy ướt hẳn.' })
    public puffCount = 2;

    @property({ min: 0.05, tooltip: 'Nhịp giữa 2 phát xịt (giây).' })
    public puffInterval = 0.45;

    @property({ min: 0.01, tooltip: 'Thời gian giấy sẫm màu dần sau mỗi phát (giây).' })
    public wetDuration = 0.2;

    @property({ min: 0, tooltip: 'Nới rộng vùng giấy khi kiểm tra xịt trúng (world).' })
    public sprayPadding = 40;

    @property({ type: Enum(FxType), tooltip: 'Sound mỗi phát xịt.' })
    public puffFxType: FxType = FxType.SprayPuff;

    @property({ type: [ParticleSystem2D], tooltip: 'Particle tia xịt (tuỳ chọn), bắn 1 lần mỗi phát.' })
    public sprayParticles: ParticleSystem2D[] = [];

    private _cooldown = 0;
    private _finishing = false;
    private readonly _wetState = { value: 0 };

    protected get CanWorkWhenNotCurrent(): boolean {
        return !!this.wetWipe?.CanBeWetted && !this.wetWipe.IsFullyWet;
    }

    protected onStepStart(): void {
        this._finishing = false;
        if (this.wetWipe?.IsFullyWet) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        return this.wetWipe?.node ?? null;
    }

    protected onToolDragStart(): void {
        this._cooldown = 0;
    }

    protected onToolDrag(dt: number): boolean {
        const target = this.wetWipe;
        if (this._finishing || !target || !target.CanBeWetted || target.IsFullyWet) return false;
        if (!this.isPointInside(this._point, target.node, this.sprayPadding)) return false;

        this._cooldown -= dt;
        if (this._cooldown <= 0) {
            this._cooldown = this.puffInterval;
            this.puff(target);
        }
        return true;
    }

    private puff(target: WetWipe): void {
        Ply_SoundManager.Ins?.PlayFx(this.puffFxType);
        for (const particle of this.sprayParticles) {
            if (!particle?.isValid) continue;
            particle.node.active = true;
            particle.resetSystem();
            this.scheduleOnce(() => particle.isValid && particle.stopSystem(), 0.15);
        }

        const step = 1 / Math.max(1, this.puffCount);
        const next = Math.min(1, Math.round((target.Wet + step) * 1000) / 1000);
        Tween.stopAllByTarget(this._wetState);
        this._wetState.value = target.Wet;
        tween(this._wetState)
            .to(this.wetDuration, { value: next }, { onUpdate: () => target.SetWet(this._wetState.value) })
            .call(() => target.SetWet(next))
            .start();

        if (next >= 1) {
            this._finishing = true;
            // Chỉ báo xong khi đang là lượt của bình xịt; xịt sớm thì chỉ làm ướt giấy.
            this.scheduleOnce(() => {
                this._finishing = false;
                if (this.IsCurrentStep) this.Complete();
            }, this.wetDuration);
        }
    }
}
