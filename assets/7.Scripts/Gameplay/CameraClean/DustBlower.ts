import { _decorator, Node, ParticleSystem2D, Tween, tween, UIOpacity, Enum } from 'cc';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CameraCleanTool } from './CameraCleanTool';

const { ccclass, property } = _decorator;

/**
 * Bước 4: bóp quả thổi bụi vào kính (dust_on camera_glass).
 * Thổi theo nhịp: mỗi phát bóp (đổi hình + sound) bụi mờ đi 1 phần; đủ puffCount phát thì sạch.
 */
@ccclass('DustBlower')
export class DustBlower extends CameraCleanTool {
    @property({ min: 1, step: 1, tooltip: 'Số phát bóp để bụi sạch hẳn.' })
    public puffCount = 2;

    @property({ min: 0.05, tooltip: 'Nhịp giữa 2 phát bóp (giây).' })
    public puffInterval = 0.45;

    @property({ min: 0.01, tooltip: 'Thời gian giữ hình bóp mỗi phát (giây).' })
    public squeezeDuration = 0.15;

    @property({ min: 0.01, tooltip: 'Thời gian bụi mờ đi sau mỗi phát (giây).' })
    public fadeDuration = 0.25;

    @property({ min: 0, tooltip: 'Nới rộng vùng bụi khi kiểm tra thổi trúng (world).' })
    public blowPadding = 40;

    @property({ type: Enum(FxType), tooltip: 'Sound mỗi phát bóp.' })
    public puffFxType: FxType = FxType.BlowDryer;

    @property({ type: [ParticleSystem2D], tooltip: 'Particle luồng hơi, bắn 1 lần mỗi phát bóp.' })
    public puffParticles: ParticleSystem2D[] = [];

    @property({ type: Node, tooltip: 'Hình quả bóp bình thường (dust_blower-001).' })
    public normalVisual: Node | null = null;

    @property({ type: Node, tooltip: 'Hình quả bóp đang bóp (dust_blower2).' })
    public squeezedVisual: Node | null = null;

    private _puffs = 0;
    private _cooldown = 0;
    private _finishing = false;

    protected onLoad(): void {
        super.onLoad();
        this.setSqueezed(false);
    }

    protected onStepStart(): void {
        this._puffs = 0;
        this._cooldown = 0;
        this._finishing = false;
        const dust = this.Face?.glassDust;
        if (!dust || !dust.activeInHierarchy) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        const dust = this.Face?.glassDust;
        return dust?.activeInHierarchy ? dust : null;
    }

    protected onToolDragStart(): void {
        // Phát đầu tiên bắn ngay khi vừa chĩa trúng.
        this._cooldown = 0;
    }

    protected onToolDrag(dt: number): boolean {
        if (this._finishing) return false;
        const dust = this.Face?.glassDust;
        if (!dust || !this.isPointInside(this._point, dust, this.blowPadding)) return false;

        this._cooldown -= dt;
        if (this._cooldown <= 0) {
            this._cooldown = this.puffInterval;
            this.puff(dust);
        }
        return true;
    }

    protected onToolDragEnd(): void {
        this.unschedule(this.releaseSqueeze);
        this.setSqueezed(false);
    }

    private puff(dust: Node): void {
        this._puffs++;
        Ply_SoundManager.Ins?.PlayFx(this.puffFxType);
        for (const particle of this.puffParticles) {
            if (!particle?.isValid) continue;
            particle.node.active = true;
            particle.resetSystem();
        }
        this.setSqueezed(true);
        this.unschedule(this.releaseSqueeze);
        this.scheduleOnce(this.releaseSqueeze, this.squeezeDuration);

        const total = Math.max(1, this.puffCount);
        const opacity = dust.getComponent(UIOpacity) ?? dust.addComponent(UIOpacity);
        const target = Math.round(255 * Math.max(0, 1 - this._puffs / total));
        Tween.stopAllByTarget(opacity);
        tween(opacity).to(this.fadeDuration, { opacity: target }, { easing: 'sineOut' }).start();

        if (this._puffs >= total) {
            this._finishing = true;
            this.scheduleOnce(() => {
                dust.active = false;
                this.Complete();
            }, this.fadeDuration);
        }
    }

    private releaseSqueeze(): void {
        this.setSqueezed(false);
    }

    private setSqueezed(squeezed: boolean): void {
        if (this.normalVisual) this.normalVisual.active = !squeezed;
        if (this.squeezedVisual) this.squeezedVisual.active = squeezed;
    }
}
