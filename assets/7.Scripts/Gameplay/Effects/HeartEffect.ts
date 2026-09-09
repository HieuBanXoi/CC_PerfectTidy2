import { _decorator, Tween, tween, Vec3 } from 'cc';
import { PoolMember } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

@ccclass('HeartEffect')
export class HeartEffect extends PoolMember {

    @property
    public defaultLifeTime: number = 1.0;

    private defaultScale: Vec3 = new Vec3(1, 1, 1);
    private defaultLocalEulerAngles: Vec3 = new Vec3(0, 0, 0);
    private isDefaultStateCached: boolean = false;
    private wobbleTween: Tween<{ angle: number }> | null = null;
    private readonly wobbleState = { angle: 0 };

    public DeSpawnByTime() {
        this.unschedule(this.DeSpawn);
        this.scheduleOnce(this.DeSpawn, 3.0);
    }

    public PlaySpawnWithScale(scaleMultiplier: number) {
        this.PlaySpawn(this.defaultLifeTime, scaleMultiplier);
    }

    public PlaySpawn(lifeTime: number = this.defaultLifeTime, scaleMultiplier: number = 1.0) {
        this.CacheDefaultState();
        this.ResetState();

        this.node.setScale(Vec3.ZERO);
        Ply_SoundManager.Ins.PlayFx(FxType.Complete);

        const targetScale = new Vec3(
            this.defaultScale.x * Math.max(0, scaleMultiplier),
            this.defaultScale.y * Math.max(0, scaleMultiplier),
            this.defaultScale.z * Math.max(0, scaleMultiplier)
        );

        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(0.25, { scale: targetScale }, { easing: 'backOut' })
            .start();

        this.playWorldSpaceWobble();

        this.scheduleOnce(this.DeSpawn, lifeTime);
    }

    public DeSpawn() {
        this.ResetState();
        World.instance?.poolManager?.despawn(this);
    }

    private CacheDefaultState() {
        if (this.isDefaultStateCached) return;

        if (this.node.scale.x !== 0 && this.node.scale.y !== 0) {
            Vec3.copy(this.defaultScale, this.node.scale);
        } else {
            this.defaultScale.set(1, 1, 1);
        }

        Vec3.copy(this.defaultLocalEulerAngles, this.node.eulerAngles);
        this.isDefaultStateCached = true;
    }

    private ResetState() {
        this.unschedule(this.DeSpawn);
        Tween.stopAllByTarget(this.node);
        this.wobbleTween?.stop();
        this.wobbleTween = null;
        this.wobbleState.angle = 0;

        if (this.isDefaultStateCached) {
            this.node.setScale(this.defaultScale);
            this.node.eulerAngles = this.defaultLocalEulerAngles;
        }
        this.node.setWorldRotationFromEuler(0, 0, 0);
    }

    /** Rotates in world space so a rotated/scaled item cannot amplify the wobble. */
    private playWorldSpaceWobble(): void {
        this.wobbleTween?.stop();
        this.wobbleState.angle = 0;
        this.node.setWorldRotationFromEuler(0, 0, 0);

        this.wobbleTween = tween(this.wobbleState)
            .delay(0.25)
            .to(0.12, { angle: 3 }, { easing: 'sineOut', onUpdate: value => this.applyWorldRotation(value.angle) })
            .to(0.18, { angle: -3 }, { easing: 'sineInOut', onUpdate: value => this.applyWorldRotation(value.angle) })
            .to(0.12, { angle: 0 }, { easing: 'sineIn', onUpdate: value => this.applyWorldRotation(value.angle) })
            .call(() => this.wobbleTween = null)
            .start();
    }

    private applyWorldRotation(angle: number): void {
        this.node.setWorldRotationFromEuler(0, 0, angle);
    }

}
