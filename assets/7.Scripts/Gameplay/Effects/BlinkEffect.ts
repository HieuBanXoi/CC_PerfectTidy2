import { _decorator } from 'cc';
import { World } from '../../Core/Managers/World';
import { PoolMember } from '../../Core/Pooling/PoolMember';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
const { ccclass, property } = _decorator;

@ccclass('BlinkEffect')
export class BlinkEffect extends PoolMember {
    @property
    public defaultLifeTime = 1.0;

    public DeSpawnByTime(): void {
        this.unschedule(this.DeSpawn);
        this.scheduleOnce(this.DeSpawn, this.defaultLifeTime);
    }

    public DeSpawn(): void {
        World.instance?.poolManager?.despawn(this);
    }
}


