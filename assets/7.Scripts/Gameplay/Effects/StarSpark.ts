import { _decorator, Enum, ParticleSystem2D } from 'cc';
import { World } from '../../Core/Managers/World';
import { PoolMember } from '../../Core/Pooling/PoolMember';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

/** Pooled star burst that restarts its particles and returns itself to the pool. */
@ccclass('StarSpark')
export class StarSpark extends PoolMember {
    @property({ min: 0.01, tooltip: 'Seconds before this effect returns to its pool.' })
    public defaultLifeTime = 1.5;

    @property({ tooltip: 'Play a sound whenever the star spark is spawned.' })
    public playSpawnSound = true;

    @property({ type: Enum(FxType), tooltip: 'Sound effect played when the star spark appears.' })
    public spawnFxType: FxType = FxType.StarSpark;

    public PlaySpawn(): void {
        this.unschedule(this.DeSpawn);
        this.getComponentsInChildren(ParticleSystem2D).forEach(particle => particle.resetSystem());
        if (this.playSpawnSound) Ply_SoundManager.Ins?.PlayFx(this.spawnFxType);
        this.scheduleOnce(this.DeSpawn, this.defaultLifeTime);
    }

    public DeSpawn(): void {
        this.getComponentsInChildren(ParticleSystem2D).forEach(particle => particle.stopSystem());
        World.instance?.poolManager?.despawn(this);
    }
}
