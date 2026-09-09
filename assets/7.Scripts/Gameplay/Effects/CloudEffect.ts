import { _decorator, ParticleSystem2D, Vec3 } from 'cc';
import { World } from '../../Core/Managers/World';
import { PoolMember } from '../../Core/Pooling/PoolMember';

const { ccclass, property } = _decorator;

/** Pooled cloud burst played when a cleaning item appears. */
@ccclass('CloudEffect')
export class CloudEffect extends PoolMember {
    @property({ min: 0.01, tooltip: 'How long the cloud remains active before returning to its pool.' })
    public defaultLifeTime = 0.5;

    private particles: ParticleSystem2D[] = [];
    private defaultScale = new Vec3(1, 1, 1);
    private isDefaultScaleCached = false;

    protected onLoad(): void {
        this.particles = this.getComponentsInChildren(ParticleSystem2D);
        Vec3.copy(this.defaultScale, this.node.scale);
        this.isDefaultScaleCached = true;
    }

    public PlaySpawn(lifeTime: number = this.defaultLifeTime, scaleMultiplier: number = 1): void {
        if (this.particles.length === 0) {
            this.particles = this.getComponentsInChildren(ParticleSystem2D);
        }
        if (!this.isDefaultScaleCached) {
            Vec3.copy(this.defaultScale, this.node.scale);
            this.isDefaultScaleCached = true;
        }

        this.unschedule(this.DeSpawn);
        const multiplier = Math.max(0, scaleMultiplier);
        this.node.setScale(
            this.defaultScale.x * multiplier,
            this.defaultScale.y * multiplier,
            this.defaultScale.z * multiplier,
        );
        this.particles.forEach(particle => particle.resetSystem());
        this.scheduleOnce(this.DeSpawn, Math.max(0.01, lifeTime));
    }

    public PlaySpawnWithScale(scaleMultiplier: number): void {
        this.PlaySpawn(this.defaultLifeTime, scaleMultiplier);
    }

    public DeSpawn(): void {
        this.unschedule(this.DeSpawn);
        this.particles.forEach(particle => particle.stopSystem());
        World.instance?.poolManager?.despawn(this);
    }

    protected onDisable(): void {
        this.unschedule(this.DeSpawn);
    }
}
