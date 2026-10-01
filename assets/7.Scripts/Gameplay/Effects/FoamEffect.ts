import { _decorator, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { PoolMember, PoolType } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';

const { ccclass, property } = _decorator;

/**
 * Bọt xà phòng do SprayBottle xịt ra (pooled).
 * PlaySpawn: nảy lên với scale/góc ngẫu nhiên. FadeOut: mờ dần rồi trả về pool.
 */
@ccclass('FoamEffect')
export class FoamEffect extends PoolMember {
    @property({ min: 0.01, tooltip: 'Thời gian nảy lên khi spawn (giây).' })
    public spawnDuration = 0.25;

    @property({ min: 0, tooltip: 'Scale ngẫu nhiên nhỏ nhất (nhân với scale gốc của prefab).' })
    public randomScaleMin = 0.8;

    @property({ min: 0, tooltip: 'Scale ngẫu nhiên lớn nhất (nhân với scale gốc của prefab).' })
    public randomScaleMax = 1.2;

    @property({ tooltip: 'Xoay ngẫu nhiên khi spawn.' })
    public randomRotation = true;

    @property({ min: 0.01, tooltip: 'Thời gian mờ dần mặc định (giây).' })
    public fadeDuration = 0.4;

    private _baseScale = new Vec3(1, 1, 1);
    private _opacity: UIOpacity | null = null;
    private _isFading = false;
    private _targetScale = 1;

    public get IsFading(): boolean {
        return this._isFading;
    }

    protected onLoad(): void {
        this.type = PoolType.Foam;
        if (this.node.scale.x !== 0) Vec3.copy(this._baseScale, this.node.scale);
        this._opacity = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity);
    }

    public PlaySpawn(scaleMultiplier = 1): void {
        this.resetState();
        const random = this.randomScaleMin + Math.random() * Math.max(0, this.randomScaleMax - this.randomScaleMin);
        const s = Math.max(0, scaleMultiplier) * random;
        const target = new Vec3(this._baseScale.x * s, this._baseScale.y * s, this._baseScale.z);

        this._targetScale = s;
        if (this.randomRotation) this.node.angle = Math.random() * 360;
        this.node.setScale(0, 0, target.z);
        tween(this.node)
            .to(this.spawnDuration, { scale: target }, { easing: 'backOut' })
            .start();
    }

    /**
     * Bán kính (world) bọt che phủ khi đã nảy lên hết cỡ, tính từ UITransform
     * của bọt (hoặc sprite con) và scale của node cha.
     */
    public GetCoverRadius(): number {
        const transform = this.getComponent(UITransform) ?? this.getComponentInChildren(UITransform);
        const size = transform ? Math.min(transform.width, transform.height) : 100;
        const parentScale = Math.abs(this.node.parent?.worldScale.x ?? 1);
        return 0.5 * size * Math.abs(this._baseScale.x) * this._targetScale * parentScale;
    }

    /** Mờ dần rồi trả về pool. Gọi nhiều lần chỉ có tác dụng lần đầu. */
    public FadeOut(duration = this.fadeDuration): void {
        if (this._isFading) return;
        this._isFading = true;

        const opacity = this._opacity;
        Tween.stopAllByTarget(this.node);
        const scale = this.node.scale.clone().multiplyScalar(0.85);
        tween(this.node).to(duration, { scale }, { easing: 'sineIn' }).start();
        if (!opacity) {
            this.scheduleOnce(() => this.DeSpawn(), duration);
            return;
        }
        Tween.stopAllByTarget(opacity);
        tween(opacity)
            .to(duration, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => this.DeSpawn())
            .start();
    }

    public DeSpawn(): void {
        this.resetState();
        World.instance?.poolManager?.despawn(this);
    }

    private resetState(): void {
        this._isFading = false;
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this.node);
        this.node.setScale(this._baseScale);
        this.node.angle = 0;
        if (this._opacity) {
            Tween.stopAllByTarget(this._opacity);
            this._opacity.opacity = 255;
        }
    }

    protected onDisable(): void {
        Tween.stopAllByTarget(this.node);
        if (this._opacity) Tween.stopAllByTarget(this._opacity);
    }
}
