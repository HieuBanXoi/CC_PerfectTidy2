import { _decorator, Enum, Node, Tween, tween, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemMoveToTarget } from '../Items/Components/ItemMoveToTarget';
import { TrashBin } from '../Items/Interactables/TrashBin';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { GameManager } from '../Systems/GameManager';
import { HandTutManager } from '../Systems/HandTutManager';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

/**
 * Rác trên bàn: kéo thả vào TrashBin thì rác nhảy vào thùng, thu nhỏ rồi biến mất.
 * Mỗi rác là 1 slot trong ItemCleanManager.items nhưng nhặt theo thứ tự nào cũng được:
 * rác đã vào thùng trước lượt sẽ được ItemCleanManager bỏ qua (ShouldSkipCleanStep).
 * Tự thêm ItemDraggable / ItemMoveToTarget nếu node chưa có (ItemMoveToTarget chỉ dùng làm đích cho HandTut).
 */
@ccclass('DeskTrash')
export class DeskTrash extends Item {
    @property({ type: TrashBin, tooltip: 'Thùng rác. Để trống: TrashBin đầu tiên trong scene.' })
    public trashBin: TrashBin | null = null;

    @property({ type: Node, tooltip: 'Điểm rác rơi vào thùng (TrashInPOs). Để trống: node thùng rác.' })
    public dropPoint: Node | null = null;

    @property({ type: ItemCleanManager, tooltip: 'Để trống: ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ min: 0.01, tooltip: 'Thời gian rác nhảy vào thùng (giây).' })
    public jumpDuration = 0.4;

    @property({ tooltip: 'Độ cao cung nhảy vào thùng (local của dropPoint).' })
    public jumpHeight = 160;

    @property({ type: Enum(FxType), tooltip: 'Sound khi thả trúng thùng.' })
    public dropFxType: FxType = FxType.Wipe;

    @property({ type: Enum(FxType), tooltip: 'Sound khi rác rơi vào thùng.' })
    public arriveFxType: FxType = FxType.PlaceTrash;

    private _collected = false;
    private readonly _onDropSuccess = () => this.MoveToBin();

    public get IsCollected(): boolean {
        return this._collected;
    }

    protected onLoad(): void {
        // Thêm component tương tác trước khi Item.onLoad cache lại.
        if (!this.getComponent(ItemDraggable)) this.addComponent(ItemDraggable);
        if (!this.getComponent(ItemMoveToTarget)) this.addComponent(ItemMoveToTarget);
        super.onLoad();
        this.setupDrag();
    }

    protected onEnable(): void {
        this.itemDraggable?.onDropSuccess.addListener(this._onDropSuccess);
    }

    protected onDisable(): void {
        this.itemDraggable?.onDropSuccess.removeListener(this._onDropSuccess);
    }

    // ---------------- Gọi từ ItemCleanManager / HandTut ----------------

    /** Rác đã vào thùng trước lượt của nó: ItemCleanManager bỏ qua slot này. */
    public ShouldSkipCleanStep(): boolean {
        return this._collected;
    }

    /** Nhặt rác không cần theo lượt: kéo rác khác lượt không bị phạt BreakHeart. */
    public CanWorkOffTurnNow(): boolean {
        return !this._collected;
    }

    public GetHandTutTarget(): Node | null {
        return this.DropPoint;
    }

    public ShouldSpawnHeartOnDone(): boolean {
        return false;
    }

    public ShouldPlayDoneSound(): boolean {
        return false;
    }

    // ---------------- Internals ----------------

    private setupDrag(): void {
        const bin = this.Bin;
        const draggable = this.itemDraggable;
        if (draggable) {
            if (bin) draggable.targetItemType = bin.itemType;
            draggable.returnToStartOnDragFailed = true;
            draggable.spawnBreakHeartOnDropFail = false;
        }
        if (this.itemMoveToTarget) this.itemMoveToTarget.defaultTarget = this.DropPoint!;
        if (!bin) console.warn(`[DeskTrash] Không tìm thấy TrashBin cho "${this.node.name}".`);
    }

    private MoveToBin(): void {
        const bin = this.Bin;
        if (this._collected || !bin) return;
        this._collected = true;
        this.isDone = true;
        this.itemDraggable?.DisableComponent();
        Ply_SoundManager.Ins?.PlayFx(this.dropFxType);

        const trash = this.node;
        const target = this.DropPoint ?? bin.node;
        Tween.stopAllByTarget(trash);
        trash.setParent(target, true);

        const startPos = trash.position.clone();
        const startScale = trash.scale.clone();
        const state = { t: 0 };
        tween(state)
            .to(this.jumpDuration, { t: 1 }, {
                onUpdate: () => {
                    if (!trash.isValid) return;
                    const t = state.t;
                    const arc = this.jumpHeight * 4 * t * (1 - t);
                    trash.setPosition(startPos.x * (1 - t), startPos.y * (1 - t) + arc, startPos.z);
                    // Giữ kích thước lúc bay, thu nhỏ dần khi tới miệng thùng.
                    const s = 1 - t * t;
                    trash.setScale(startScale.x * s, startScale.y * s, startScale.z);
                },
            })
            .call(() => this.arriveAtBin(bin))
            .start();
    }

    private arriveAtBin(bin: TrashBin): void {
        this.node.active = false;
        Ply_SoundManager.Ins?.PlayFx(this.arriveFxType);
        GameManager.Ins?.MoveOne();
        bin.AddTrash();

        // Chỉ rác đang tới lượt mới chuyển lượt; rác khác lượt sẽ được bỏ qua khi tới slot của nó.
        const manager = this.Manager;
        if (manager && manager.currentItemIndex >= 0 && manager.items[manager.currentItemIndex] === this.node) {
            manager.ItemCleanDone();
        } else {
            // Rác khác lượt: vẫn gợi ý rác tiếp theo sau nextStepHintDelay, không bắt đợi idleDelay.
            HandTutManager.Ins?.HintNextStepSoon();
        }
    }

    private get Bin(): TrashBin | null {
        if (this.trashBin?.isValid) return this.trashBin;
        const bins = (this.node.scene?.getComponentsInChildren(TrashBin) ?? []) as TrashBin[];
        this.trashBin = bins[0] ?? null;
        return this.trashBin;
    }

    private get DropPoint(): Node | null {
        return this.dropPoint?.isValid ? this.dropPoint : this.Bin?.node ?? null;
    }

    private get Manager(): ItemCleanManager | null {
        return this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
    }
}
