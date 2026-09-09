import { _decorator } from 'cc';
import { World } from '../../Core/Managers/World';
import { PoolMember } from '../../Core/Pooling/PoolMember';

const { ccclass, property } = _decorator;

@ccclass('MergeEffect')
export class MergeEffect extends PoolMember {
    @property
    public defaultLifeTime: number = 1.0;

    public DeSpawnByTime(lifeTime?: number): void {
        this.unschedule(this.DeSpawn);
        this.scheduleOnce(this.DeSpawn, lifeTime ?? this.defaultLifeTime);
    }

    public DeSpawn(): void {
        World.instance?.poolManager?.despawn(this);
    }
}
