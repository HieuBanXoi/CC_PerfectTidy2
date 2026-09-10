import { _decorator, Node, Vec3 } from 'cc';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
import { HandTutManager } from './HandTutManager';
import type { HeartEffect } from '../Effects/HeartEffect';
import { Item } from '../Items/Components/Item';
import type { ItemDraggable } from '../Items/Components/ItemDraggable';

const { ccclass, property } = _decorator;

/**
 * Manages cleaning tools/items (CleanItem, Clipper, etc.) that are already present on the scene.
 * Controls turn-by-turn order: only the current item can be interacted with / dragged.
 * When an item finishes cleaning (ItemCleanDone), it stays visible on scene (does NOT disappear),
 * disables its interaction, spawns a Heart effect at targetItem, and enables the next item.
 */
@ccclass('ItemCleanManager')
export class ItemCleanManager extends Ply_Singleton<ItemCleanManager> {
    @property({ type: [Node], tooltip: 'Danh sách node Item clean theo thứ tự thực hiện. Kéo trực tiếp node có component Item (Shower, Clipper, CleanItem...), không kéo component UITransform.' })
    public items: Node[] = [];

    @property({ type: Node, tooltip: 'Node đối tượng được dọn dẹp/làm đẹp (nếu có). Mỗi khi 1 item xong sẽ spawn heart tại đây.' })
    public targetItem: Node | null = null;

    @property({ tooltip: 'Tự động kích hoạt lượt cho item đầu tiên khi bắt đầu' })
    public autoStart = true;

    @property({ type: Ply_Event, tooltip: 'Được gọi khi tất cả các item trong chuỗi đã hoàn thành' })
    public onAllItemsCleaned: Ply_Event = new Ply_Event();

    @property({ readonly: true, tooltip: 'Index của item đang thực hiện (-1 khi chưa bắt đầu hoặc đã xong)' })
    public currentItemIndex = -1;

    private hasCompletedSequence = false;

    protected onLoad(): void {
        super.onLoad();
    }

    protected start(): void {
        if (this.autoStart) this.StartItems();
    }

    /** Khởi động lượt thực hiện từ item đầu tiên */
    public StartItems(): void {
        this.currentItemIndex = -1;
        this.hasCompletedSequence = false;
        console.log(`[ItemCleanManager] Start sequence (${this.items.length} item slot(s)).`);
        this.ActivateNextItem();
        this.scheduleOnce(() => {
            HandTutManager.Ins?.StartHandTutNoDelay();
        }, 0);
    }

    /**
     * Được gọi khi item hiện tại làm xong công việc.
     * Item KHÔNG biến mất (vẫn giữ nguyên trên Scene, vẫn drag được),
     * đánh dấu isDone = true, spawn HeartFX tại targetItem (nếu có) và kích hoạt lượt onProcess kế tiếp.
     */
    public ItemCleanDone(): void {
        if (this.currentItemIndex < 0 || this.hasCompletedSequence) return;

        const currentItem = this.getItemAt(this.currentItemIndex);
        if (currentItem) {
            console.log(`[ItemCleanManager] Done item ${this.currentItemIndex + 1}/${this.items.length}: ${currentItem.node.name} (${currentItem.constructor.name}).`);
            currentItem.isDone = true;
            currentItem.onProcess = false;
        } else {
            console.warn(`[ItemCleanManager] Done was called for invalid item slot ${this.currentItemIndex + 1}.`);
        }

        // Spawn Heart effect tại targetItem nếu được cấu hình
        this.spawnHeartAtTarget();

        // Chuyển sang item tiếp theo
        this.ActivateNextItem();
    }

    /** Chuyển lượt sang item tiếp theo trong danh sách */
    public ActivateNextItem(): void {
        if (this.hasCompletedSequence) return;

        let nextIndex = this.currentItemIndex + 1;
        while (nextIndex < this.items.length && !this.getItemAt(nextIndex)) {
            nextIndex++;
        }

        if (nextIndex >= this.items.length) {
            this.currentItemIndex = -1;
            this.hasCompletedSequence = true;
            console.log('[ItemCleanManager] All items cleaned.');
            this.onAllItemsCleaned?.invoke();
            return;
        }

        this.currentItemIndex = nextIndex;
        this.updateItemsActiveState();
        const nextItem = this.getItemAt(nextIndex);
        if (nextItem) {
            console.log(`[ItemCleanManager] Start item ${nextIndex + 1}/${this.items.length}: ${nextItem.node.name} (${nextItem.constructor.name}).`);
        }
    }

    /** Cập nhật lượt: tất cả items đều có thể drag được, riêng onProcess được bật theo lượt cho item hiện tại */
    private updateItemsActiveState(): void {
        const currentNode = this.items[this.currentItemIndex] ?? null;
        for (let i = 0; i < this.items.length; i++) {
            const item = this.getItemAt(i);
            if (!item) continue;

            // Một node (ví dụ Shower 2 step) có thể xuất hiện nhiều lần trong list.
            // Bật onProcess theo node của slot hiện tại để entry trùng không tắt lại cờ này.
            const isCurrent = item.node === currentNode;
            this.setItemInteractive(item, isCurrent);
        }
    }

    /** Tất cả item vẫn drag được; chỉ item đang xử lý có onProcess để thực hiện clean. */
    private setItemInteractive(item: Item, isCurrent: boolean): void {
        item.onProcess = isCurrent;

        const draggable = item.getComponent('ItemDraggable') as unknown as ItemDraggable | null;
        if (draggable) {
            draggable.isDraggable = true;
        }
    }

    /** Lấy Item gameplay từ node đã gán trong Inspector; node không có Item sẽ bị bỏ qua. */
    private getItemAt(index: number): Item | null {
        const node = this.items[index];
        if (!node || !node.isValid) {
            return null;
        }
        return node.getComponent(Item);
    }

    /** Spawn Heart effect từ Pool tại vị trí targetItem */
    private spawnHeartAtTarget(): void {
        if (!this.targetItem || !this.targetItem.isValid) return;

        const spawnPos = this.targetItem.worldPosition.clone();
        const heart = World.instance?.poolManager?.spawnType<HeartEffect>(PoolType.HeartFX, spawnPos);
        if (heart) {
            if (heart.node.parent !== this.targetItem) {
                heart.node.setParent(this.targetItem);
            }
            heart.node.setPosition(0, 0, 0);
            heart.PlaySpawn();
        }
    }

    public resetInEditor(): void {
        if (!this.onAllItemsCleaned) this.onAllItemsCleaned = new Ply_Event();
    }
}
