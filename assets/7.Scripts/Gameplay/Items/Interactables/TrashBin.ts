import { _decorator, Node } from 'cc';
import type { CloudEffect } from '../../Effects/CloudEffect';
import { Item } from '../Components/Item';
import { ItemCleanManager } from '../../Systems/ItemCleanManager';
import { World } from '../../../Core/Managers/World';
import { PoolType } from '../../../Core/Pooling/PoolMember';

const { ccclass, property } = _decorator;

/** Item target that advances ItemCleanManager after receiving enough trash. */
@ccclass('TrashBin')
export class TrashBin extends Item {
    @property({ type: ItemCleanManager, tooltip: 'Manager advanced after this bin receives all required trash.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ min: 1, tooltip: 'Number of AddTrash calls required before advancing to the next item.' })
    public requiredTrashCount = 1;

    @property({ type: Node, tooltip: 'World position where a smoke cloud appears after trash is added.' })
    public smokeSpawnPoint: Node | null = null;

    @property({ min: 0, tooltip: 'Scale multiplier for the smoke cloud spawned when trash is added.' })
    public smokeScale = 1;

    @property({ readonly: true, tooltip: 'Trash currently added to this bin.' })
    public trashCount = 0;

    private isFull = false;

    /** Call this after one trash item is successfully added to the bin. */
    public AddTrash(): void {
        if (this.isFull) return;

        this.trashCount++;
        this.SpawnAddTrashSmoke();
        if (this.trashCount < Math.max(1, this.requiredTrashCount)) return;

        this.isFull = true;
        const manager = this.itemCleanManager ?? (ItemCleanManager.Ins as ItemCleanManager | null);
        if (!manager) {
            console.warn(`[TrashBin] Assign ItemCleanManager on "${this.node.name}".`);
            return;
        }

        manager.ItemCleanDone();
    }

    /** Resets this bin so it can accept trash again. */
    public ResetTrash(): void {
        this.trashCount = 0;
        this.isFull = false;
    }

    private SpawnAddTrashSmoke(): void {
        const spawnPoint = this.smokeSpawnPoint ?? this.node;
        const cloud = World.instance?.poolManager?.spawnType<CloudEffect>(PoolType.Cloud, spawnPoint.worldPosition);
        if (!cloud) return;

        const parent = spawnPoint.parent;
        if (parent) {
            const worldPosition = spawnPoint.worldPosition.clone();
            cloud.node.setParent(parent);
            cloud.node.setWorldPosition(worldPosition);
            cloud.node.setSiblingIndex(parent.children.length - 1);
        }
        cloud.PlaySpawnWithScale(this.smokeScale);
    }
}
