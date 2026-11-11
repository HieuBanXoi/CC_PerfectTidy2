import { _decorator, Node } from 'cc';
import { Item } from './Item';
import { ItemDraggable } from './ItemDraggable';

const { ccclass, property } = _decorator;

/**
 * Đồ mặc (sweater, glasses, chain): kéo được từ đầu nhưng không thả vào đâu được,
 * luôn quay về chỗ cũ. Dùng trong ItemCleanManager để HandTut kéo đồ vào nhân vật.
 */
@ccclass('DressItem')
export class DressItem extends Item {
    @property({ type: Node, tooltip: 'Điểm đích cho HandTut khi tới lượt mặc đồ (ví dụ thân Turkey).' })
    public dressTarget: Node | null = null;

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
    }

    public GetHandTutTarget(): Node | null {
        return this.dressTarget;
    }
}
