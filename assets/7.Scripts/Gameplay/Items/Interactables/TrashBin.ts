import { _decorator, Node, Tween, tween, Vec3 } from 'cc';
import type { CloudEffect } from '../../Effects/CloudEffect';
import { Item } from '../Components/Item';
import { ItemCleanManager } from '../../Systems/ItemCleanManager';
import { TrashBinLid } from './TrashBinLid';
import { World } from '../../../Core/Managers/World';
import { PoolType } from '../../../Core/Pooling/PoolMember';

const { ccclass, property } = _decorator;

/**
 * Item target that advances ItemCleanManager after receiving enough trash.
 * With a TrashBinLid assigned, the bin stays visible when full and waits for
 * the lid to be dropped on it before advancing.
 */
@ccclass('TrashBin')
export class TrashBin extends Item {
    @property({ type: ItemCleanManager, tooltip: 'Manager advanced after this bin receives all required trash.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: [Item], tooltip: 'Every Trash that must go into this bin. Leave empty to collect all Trash components in the scene (including inactive ones) on load.' })
    public trashes: Item[] = [];

    @property({ min: 1, tooltip: 'Fallback AddTrash count when no Trash is registered in `trashes`.' })
    public requiredTrashCount = 1;

    @property({ type: Node, tooltip: 'World position where a smoke cloud appears after trash is added.' })
    public smokeSpawnPoint: Node | null = null;

    @property({ min: 0, tooltip: 'Scale multiplier for the smoke cloud spawned when trash is added.' })
    public smokeScale = 1;

    @property({ type: TrashBinLid, tooltip: 'Optional lid. When set, the full bin waits for this lid instead of advancing right away.' })
    public trashBinLid: TrashBinLid | null = null;

    @property({ type: Node, tooltip: 'Where the lid lands on this bin. Falls back to the bin node.' })
    public trashBinLidPos: Node | null = null;

    @property({ type: Node, tooltip: 'Where dropped trash moves into. Falls back to the bin node.' })
    public trashInPos: Node | null = null;

    @property({ readonly: true, tooltip: 'Trash currently added to this bin.' })
    public trashCount = 0;

    private isFull = false;
    private isLidPlaced = false;
    private readonly addedTrashes = new Set<Item>();

    public get IsFull(): boolean {
        return this.isFull;
    }

    /** Trash pieces this bin still needs before it is full. */
    public get RemainingTrashCount(): number {
        return Math.max(0, this.GetRequiredTrashCount() - this.trashCount);
    }

    protected onLoad(): void {
        super.onLoad();
        this.CollectTrashes();
    }

    /** Fills `trashes` from the scene when nothing was assigned in the Inspector. */
    private CollectTrashes(): void {
        this.trashes = this.trashes.filter(trash => trash?.isValid);
        if (this.trashes.length > 0) return;

        // Trash imports this class, so it is looked up by name to avoid a circular import.
        const found = (this.node.scene?.getComponentsInChildren('Trash') ?? []) as Item[];
        for (const trash of found) this.RegisterTrash(trash);
    }

    /** Adds a Trash to the required list (Trash calls this on load; safe to call twice). */
    public RegisterTrash(trash: Item): void {
        if (!trash?.isValid || this.trashes.includes(trash)) return;
        this.trashes.push(trash);
    }

    private GetRequiredTrashCount(): number {
        return this.trashes.length > 0 ? this.trashes.length : Math.max(1, this.requiredTrashCount);
    }

    /**
     * Khoá / mở khoá cả cụm thùng rác. ItemCleanManager gọi ở chế độ ShowAll: trước khi tới lượt
     * bin, rác và nắp vẫn hiện trên màn hình nhưng chưa nhấc lên được, nếu không người chơi có
     * thể dọn sạch thùng trước cả khi tới lượt nó.
     *
     * Nắp vẫn giữ luật riêng của nó: mở khoá rồi cũng chỉ đậy trúng khi bin đã đầy (EnableDrop).
     */
    public SetInteractable(interactable: boolean): void {
        // ItemCleanManager tắt node bin ngay trong onLoad của nó, nên TrashBin.onLoad (chỗ gọi
        // CollectTrashes) có thể chưa chạy ở lần khoá đầu tiên và `trashes` vẫn rỗng. Quét lại
        // để lần khoá đó không trôi qua vô nghĩa, để lộ rác kéo được.
        if (this.trashes.length === 0) this.CollectTrashes();

        // Danh sách vẫn rỗng nghĩa là lệnh khoá/mở này trôi qua mà không đụng được vào rác nào.
        // Đây là kiểu hỏng im lặng duy nhất của cơ chế gate nên báo ra thay vì bỏ qua.
        if (this.trashes.length === 0) {
            console.warn(`[TrashBin] "${this.node.name}" không tìm thấy Trash nào để ${interactable ? 'mở khoá' : 'khoá'}.`);
        }

        for (const trash of this.trashes) {
            this.setDraggableEnabled(trash, interactable);
        }
        this.setDraggableEnabled(this.trashBinLid, interactable);
    }

    private setDraggableEnabled(item: Item | TrashBinLid | null, enabled: boolean): void {
        if (!item?.isValid) return;

        // Tra theo tên để giữ nguyên cách né circular import đang dùng trong file này.
        const draggable = item.getComponent('ItemDraggable') as any;
        if (!draggable) return;

        if (enabled) draggable.EnableComponent?.();
        else draggable.DisableComponent?.();
    }

    /** True while the bin is full and still waiting for its lid. */
    public get IsWaitingForLid(): boolean {
        return this.isFull && !!this.trashBinLid && !this.isLidPlaced;
    }

    /** Node a dropped Trash moves to before it disappears. */
    public GetTrashInNode(): Node {
        return this.trashInPos?.isValid ? this.trashInPos : this.node;
    }

    /**
     * Call this after one trash item is successfully added to the bin.
     * Pass the Trash so the same piece is never counted twice; the bin is full
     * only once every registered Trash has been added.
     */
    public AddTrash(trash: Item | null = null): void {
        if (this.isFull) return;

        if (trash) {
            if (this.addedTrashes.has(trash)) return;
            this.RegisterTrash(trash);
            this.addedTrashes.add(trash);
            this.trashCount = this.addedTrashes.size;
        } else {
            this.trashCount++;
        }

        this.SpawnAddTrashSmoke();
        if (this.trashCount < this.GetRequiredTrashCount()) return;

        this.isFull = true;
        if (this.trashBinLid?.isValid) {
            this.trashBinLid.EnableDrop(this);
            return;
        }

        this.AdvanceCleanManager();
    }

    /** Called by TrashBinLid after it has landed on trashBinLidPos. */
    public OnLidPlaced(): void {
        if (!this.isFull || this.isLidPlaced) return;

        this.isLidPlaced = true;
        this.AdvanceCleanManager();
        this.HideLidWithBin();
    }

    /** A lid left in draggingNode is not a child of this bin, so zoom it out in step with ItemCleanManager. */
    private HideLidWithBin(): void {
        const lid = this.trashBinLid;
        if (!lid?.isValid || !lid.node.activeInHierarchy || lid.node.parent === this.node) return;

        const manager = this.itemCleanManager ?? (ItemCleanManager.Ins as ItemCleanManager | null);
        const duration = manager?.zoomDuration ?? 0.25;
        Tween.stopAllByTarget(lid.node);
        tween(lid.node)
            .to(duration, { scale: new Vec3(0, 0, lid.node.scale.z) }, { easing: 'backIn' })
            .call(() => { lid.node.active = false; })
            .start();
    }

    /** Resets this bin so it can accept trash again. */
    public ResetTrash(): void {
        this.trashCount = 0;
        this.addedTrashes.clear();
        this.isFull = false;
        this.isLidPlaced = false;
        this.trashBinLid?.ResetLid();
    }

    private AdvanceCleanManager(): void {
        const manager = this.itemCleanManager ?? (ItemCleanManager.Ins as ItemCleanManager | null);
        if (!manager) {
            console.warn(`[TrashBin] Assign ItemCleanManager on "${this.node.name}".`);
            return;
        }

        manager.ItemCleanDone(this);
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
