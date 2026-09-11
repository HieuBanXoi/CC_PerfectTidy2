import { _decorator, Node, UITransform, Vec3, Enum } from 'cc';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
import { HandTutManager } from './HandTutManager';
import type { HeartEffect } from '../Effects/HeartEffect';
import type { BreakHeartEffect } from '../Effects/BreakHeartEffect';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

interface CleanItemDragState {
    startedAsCurrent: boolean;
    wasOverTarget: boolean;
    breakHeartSpawned: boolean;
}

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

    @property({ tooltip: 'Play a sound every time an item clean step completes.' })
    public playItemCleanDoneSound = true;

    @property({ type: Enum(FxType), tooltip: 'FX played when ItemCleanDone is called.' })
    public itemCleanDoneFxType: FxType = FxType.Complete;

    private hasCompletedSequence = false;
    private readonly nonCurrentDropFailHandlers = new Map<Item, () => void>();
    private readonly nonCurrentDragStartHandlers = new Map<Item, () => void>();
    private readonly nonCurrentDropSuccessHandlers = new Map<Item, () => void>();
    private readonly cleanItemDragStates = new Map<Item, CleanItemDragState>();

    protected onLoad(): void {
        super.onLoad();
    }

    protected start(): void {
        this.bindNonCurrentDropFeedback();
        if (this.autoStart) this.StartItems();
    }

    protected onDestroy(): void {
        for (const [item, handler] of this.nonCurrentDropFailHandlers) {
            item.itemDraggable?.onDropFail.removeListener(handler);
        }
        for (const [item, handler] of this.nonCurrentDragStartHandlers) {
            item.itemDraggable?.onBeginDrag.removeListener(handler);
        }
        for (const [item, handler] of this.nonCurrentDropSuccessHandlers) {
            item.itemDraggable?.onDropSuccess.removeListener(handler);
        }
        this.nonCurrentDropFailHandlers.clear();
        this.nonCurrentDragStartHandlers.clear();
        this.nonCurrentDropSuccessHandlers.clear();
        this.cleanItemDragStates.clear();
    }

    protected update(): void {
        for (const [item, state] of this.cleanItemDragStates) {
            const draggable = item.itemDraggable;
            if (!draggable?.IsDragging) continue;

            const isOverTarget = this.isItemOverTarget(item.node);
            if (isOverTarget && !state.wasOverTarget && !state.startedAsCurrent
                && !state.breakHeartSpawned) {
                state.breakHeartSpawned = true;
                this.spawnBreakHeartAtItem(item);
            }
            state.wasOverTarget = isOverTarget;
        }
    }

    /** Khởi động lượt thực hiện từ item đầu tiên */
    public StartItems(): void {
        this.bindNonCurrentDropFeedback();
        this.currentItemIndex = -1;
        this.hasCompletedSequence = false;
        console.log(`[ItemCleanManager] Start sequence (${this.items.length} item slot(s)).`);
        this.ActivateNextItem();
        this.scheduleOnce(() => {
            const handTutManager = HandTutManager.Ins;
            if (!handTutManager) return;

            // Keep the tutorial sequence identical to the clean sequence.
            // Do not remove duplicates: one Item component can intentionally
            // represent multiple cleaning steps (for example, Shower).
            handTutManager.SetTutorialItems(this.items
                .map(node => node?.isValid ? node.getComponent(Item) : null)
                .filter((item): item is Item => !!item));
            handTutManager.StartHandTutNoDelay();
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
            if (this.playItemCleanDoneSound) {
                Ply_SoundManager.Ins?.PlayFx(this.itemCleanDoneFxType);
            }
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
            const handTutManager = HandTutManager.Ins;
            // Clipper's opening hint should point at the cleaned object. Once
            // that hint is consumed, HandTutManager falls back to Clipper's
            // current hair target for all later hints.
            if (nextIndex === 0 && typeof (nextItem as unknown as { GetHandTutTarget?: unknown }).GetHandTutTarget === 'function') {
                handTutManager?.SetFirstTutorialTarget(nextItem, this.targetItem);
            }
            handTutManager?.SetDefaultTargetForItem(nextItem);
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

    /**
     * Non-current tools remain draggable, but dropping one on targetItem is a
     * wrong-turn action. Show its feedback on the target rather than on the
     * tool that was dragged.
     */
    private bindNonCurrentDropFeedback(): void {
        for (let index = 0; index < this.items.length; index++) {
            const item = this.getItemAt(index);
            const draggable = item?.itemDraggable ?? item?.getComponent(ItemDraggable) ?? null;
            if (!item || !draggable || this.nonCurrentDropFailHandlers.has(item)) continue;

            const handler = () => this.handleNonCurrentItemDropFail(item, draggable);
            draggable.onDropFail.addListener(handler);
            this.nonCurrentDropFailHandlers.set(item, handler);

            const dragStartHandler = () => {
                this.cleanItemDragStates.set(item, {
                    startedAsCurrent: item.onProcess,
                    // Treat the first frame of a drag as an entry check too.
                    wasOverTarget: false,
                    breakHeartSpawned: false,
                });
            };
            draggable.onBeginDrag.addListener(dragStartHandler);
            this.nonCurrentDragStartHandlers.set(item, dragStartHandler);

            const dropSuccessHandler = () => this.cleanItemDragStates.delete(item);
            draggable.onDropSuccess.addListener(dropSuccessHandler);
            this.nonCurrentDropSuccessHandlers.set(item, dropSuccessHandler);
        }
    }

    private handleNonCurrentItemDropFail(item: Item, draggable: ItemDraggable): void {
        const dragState = this.cleanItemDragStates.get(item);
        this.cleanItemDragStates.delete(item);

        // A valid item may finish its cleaning step while the pointer is still
        // down. It becomes non-current immediately, but must not be penalized
        // for that same drag when it is finally released.
        if (!dragState || dragState.startedAsCurrent) return;

        // Cover a release that happens before the next manager update frame.
        if (!dragState.breakHeartSpawned && this.isItemOverTarget(item.node)) {
            dragState.breakHeartSpawned = true;
            this.spawnBreakHeartAtItem(item);
        }
        if (!dragState.breakHeartSpawned) return;

        draggable.ConsumeCurrentDropFail();
        draggable.ReturnToStartWithoutHeart();
    }

    private isItemOverTarget(itemNode: Node): boolean {
        const target = this.targetItem;
        if (!target?.isValid || !target.activeInHierarchy) return false;

        const transform = target.getComponent(UITransform);
        if (!transform) {
            return Vec3.distance(itemNode.worldPosition, target.worldPosition) <= 1;
        }

        const localPosition = transform.convertToNodeSpaceAR(itemNode.worldPosition);
        const left = -transform.anchorX * transform.width;
        const right = left + transform.width;
        const bottom = -transform.anchorY * transform.height;
        const top = bottom + transform.height;
        return localPosition.x >= left && localPosition.x <= right
            && localPosition.y >= bottom && localPosition.y <= top;
    }

    /** Spawn Heart effect từ Pool tại vị trí targetItem */
    private spawnHeartAtTarget(): void {
        const spawnNode = this.getTargetSpawnNode();
        if (!spawnNode) return;

        const spawnPos = spawnNode.worldPosition.clone();
        const heart = World.instance?.poolManager?.spawnType<HeartEffect>(PoolType.HeartFX, spawnPos);
        if (heart) {
            if (heart.node.parent !== spawnNode) {
                heart.node.setParent(spawnNode);
            }
            heart.node.setPosition(0, 0, 0);
            heart.PlaySpawn();
        }
    }

    private spawnBreakHeartAtItem(item: Item): void {
        // Wrong-turn feedback is shown on the cleaned object, so prefer the
        // target item's configured spawn point. Fall back to the dragged item
        // only when no target spawn point is configured.
        const spawnNode = this.getTargetSpawnNode()
            ?? (item.spawnHeartPos?.isValid ? item.spawnHeartPos : null);
        if (!spawnNode) return;

        const effect = World.instance?.poolManager?.spawnType<BreakHeartEffect>(
            PoolType.BreakHeartFX,
            spawnNode.worldPosition,
        );
        if (!effect) return;

        if (effect.node.parent !== spawnNode) {
            effect.node.setParent(spawnNode);
        }
        effect.node.setPosition(0, 0, 0);
        effect.PlaySpawn();
    }

    private getTargetSpawnNode(): Node | null {
        if (!this.targetItem?.isValid) return null;

        const targetItem = this.targetItem.getComponent(Item);
        if (targetItem?.spawnHeartPos?.isValid) return targetItem.spawnHeartPos;
        return this.targetItem;
    }

    public resetInEditor(): void {
        if (!this.onAllItemsCleaned) this.onAllItemsCleaned = new Ply_Event();
    }
}
