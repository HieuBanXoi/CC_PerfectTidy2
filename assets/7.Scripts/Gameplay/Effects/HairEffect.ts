import { _decorator, Tween, tween, Vec3 } from 'cc';
import { PoolMember, PoolType } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';

const { ccclass, property } = _decorator;

/**
 * HairEffect - pooled effect script for hair visuals/animations.
 */
@ccclass('HairEffect')
export class HairEffect extends PoolMember {

    @property({ tooltip: 'Default lifetime in seconds before returning to pool.' })
    public defaultLifeTime: number = 1.0;

    private defaultScale: Vec3 = new Vec3(1, 1, 1);
    private defaultLocalEulerAngles: Vec3 = new Vec3(0, 0, 0);
    private isDefaultStateCached: boolean = false;

    protected onLoad(): void {
        this.type = PoolType.HairFX;
        this.cacheDefaultState();
    }

    /**
     * Play spawn effect with custom lifetime and optional scale multiplier.
     */
    public PlaySpawn(lifeTime: number = this.defaultLifeTime, scaleMultiplier: number = 1.0): void {
        this.cacheDefaultState();
        this.resetState();

        const targetScale = new Vec3(
            this.defaultScale.x * Math.max(0, scaleMultiplier),
            this.defaultScale.y * Math.max(0, scaleMultiplier),
            this.defaultScale.z * Math.max(0, scaleMultiplier)
        );

        this.node.setScale(Vec3.ZERO);

        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(0.2, { scale: targetScale }, { easing: 'backOut' })
            .start();

        this.scheduleOnce(this.DeSpawn, Math.max(0.01, lifeTime));
    }

    public PlaySpawnWithScale(scaleMultiplier: number): void {
        this.PlaySpawn(this.defaultLifeTime, scaleMultiplier);
    }

    public DeSpawnByTime(lifeTime?: number): void {
        this.unschedule(this.DeSpawn);
        this.scheduleOnce(this.DeSpawn, lifeTime ?? this.defaultLifeTime);
    }

    public DeSpawn(): void {
        this.resetState();
        World.instance?.poolManager?.despawn(this);
    }

    private cacheDefaultState(): void {
        if (this.isDefaultStateCached) return;

        if (this.node.scale.x !== 0 && this.node.scale.y !== 0) {
            Vec3.copy(this.defaultScale, this.node.scale);
        } else {
            this.defaultScale.set(1, 1, 1);
        }

        Vec3.copy(this.defaultLocalEulerAngles, this.node.eulerAngles);
        this.isDefaultStateCached = true;
    }

    private resetState(): void {
        this.unschedule(this.DeSpawn);
        Tween.stopAllByTarget(this.node);

        if (this.isDefaultStateCached) {
            this.node.setScale(this.defaultScale);
            this.node.eulerAngles = this.defaultLocalEulerAngles;
        }
    }

    protected onDisable(): void {
        this.unschedule(this.DeSpawn);
        Tween.stopAllByTarget(this.node);
    }
}
