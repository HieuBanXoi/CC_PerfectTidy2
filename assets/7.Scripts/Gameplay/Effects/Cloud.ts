import { _decorator, Component, Node, ParticleSystem2D, tween, v3, Vec3 } from 'cc';
import { PoolMember } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
const { ccclass, property } = _decorator;

@ccclass('Cloud')
export class Cloud extends PoolMember {

    target: Node = null;

    start() {

    }


    pts: ParticleSystem2D[] = [];
    init() {
        this.pts = this.node.getComponentsInChildren(ParticleSystem2D);
        this.pts.forEach((pt) => {
            pt.node.position = v3();
            pt.resetSystem();
        });
    }

    /** Plays the cloud once at its current pooled position, then returns it to the pool. */
    public PlayAt(duration: number = 0.5): void {
        this.unscheduleAllCallbacks();
        this.target = null;
        this.init();
        this.scheduleOnce(() => this.despawn(), Math.max(0.01, duration));
    }

    /** Compatibility with the standardized pooled effect API. */
    public PlaySpawn(lifeTime: number = 0.5): void {
        this.PlayAt(lifeTime);
    }

    moveTo(pos: Vec3, callback: Function) {
        this.pts.forEach((pt) => {
            pt.resetSystem();
        });
        let dir = pos.clone().subtract(this.pts[1].node.worldPosition);
        let time = dir.length() / 2000;
        tween(this.pts[1].node).to(time, {worldPosition: pos})
        .call(() => {
            callback && callback();
            this.despawn();
        })
        .start();
    }

    despawn() {
        this.unscheduleAllCallbacks();
        this.target = null;
        this.pts.forEach((pt) => {
            pt.resetSystem();
            pt.stopSystem();
        });
        if (World.instance?.poolManager) {
            World.instance.poolManager.despawn(this);
        } else {
            this.node.active = false;
        }
    }

    update(deltaTime: number) {
        try {
            if(this.target) {
                this.node.worldPosition = this.target.worldPosition.clone();
            }
            
        } catch (error) {
            this.target = null;
            this.despawn();
        }
    }
}


