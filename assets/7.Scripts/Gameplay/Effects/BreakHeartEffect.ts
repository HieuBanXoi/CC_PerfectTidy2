import { _decorator, Tween, tween, Vec3 } from 'cc';
import { PoolMember } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

/** Pooled broken-heart feedback displayed when an item drag fails. */
@ccclass('BreakHeartEffect')
export class BreakHeartEffect extends PoolMember {
    @property
    public defaultLifeTime = 1.0;

    private defaultScale = new Vec3(1, 1, 1);
    private defaultLocalEulerAngles = new Vec3(0, 0, 0);
    private isDefaultStateCached = false;
    private wobbleTween: Tween<{ angle: number }> | null = null;
    private readonly wobbleState = { angle: 0 };

    public PlaySpawnWithScale(scaleMultiplier: number): void {
        this.PlaySpawn(this.defaultLifeTime, scaleMultiplier);
    }

    public PlaySpawn(lifeTime: number = this.defaultLifeTime, scaleMultiplier = 1.0): void {
        this.cacheDefaultState();
        this.resetState();

        this.node.setScale(Vec3.ZERO);
        Ply_SoundManager.Ins.PlayFx(FxType.Failed);

        const targetScale = new Vec3(
            this.defaultScale.x * Math.max(0, scaleMultiplier),
            this.defaultScale.y * Math.max(0, scaleMultiplier),
            this.defaultScale.z * Math.max(0, scaleMultiplier),
        );

        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(0.25, { scale: targetScale }, { easing: 'backOut' })
            .start();
        this.playWorldSpaceWobble();

        this.scheduleOnce(this.DeSpawn, lifeTime);
    }

    public DeSpawn(): void {
        this.resetState();
        World.instance?.poolManager?.despawn(this);
    }

    private cacheDefaultState(): void {
        if (this.isDefaultStateCached) return;

        if (this.node.scale.x !== 0 && this.node.scale.y !== 0) {
            Vec3.copy(this.defaultScale, this.node.scale);
        }
        Vec3.copy(this.defaultLocalEulerAngles, this.node.eulerAngles);
        this.isDefaultStateCached = true;
    }

    private resetState(): void {
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
