import { _decorator, Node, Tween, tween, Vec3 } from 'cc';
import type { TrashBin } from './TrashBin';
import { HandTutManager } from '../../Systems/HandTutManager';
import { Item } from '../Components/Item';
import { ItemMoveToTarget } from '../Components/ItemMoveToTarget';
import { ItemType } from '../Components/ItemType';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

/**
 * Lid that closes a TrashBin. It cannot be dropped until the bin is full;
 * TrashBin unlocks it via EnableDrop(), then a successful drop moves it to
 * TrashBin.trashBinLidPos and calls TrashBin.OnLidPlaced().
 */
@ccclass('TrashBinLid')
export class TrashBinLid extends Item {
    @property({ tooltip: 'Parent this lid to the bin after it has been placed. Off = the lid stays in InputManager.draggingNode (above other items); TrashBin then hides it together with the bin.' })
    public parentToBinOnPlaced = false;

    @property({ tooltip: 'Bob up and down (like Trash) after a missed drop. The lid stays where it was dropped.' })
    public enableIdleBobbing = true;

    @property({ min: 0, tooltip: 'Idle bobbing height in UI units.' })
    public idleBobbingDistance = 15;

    @property({ min: 0.1, tooltip: 'Seconds for one full bob cycle.' })
    public idleBobbingDuration = 1.5;

    @property({ tooltip: 'Xoay nắp về đúng góc ban đầu trong lúc nó bay vào thùng, để lúc đậy vào là thẳng' })
    public restoreRotationOnMoveToBin = true;

    // TrashBin references this class, so only a type import is used here to
    // avoid a runtime circular import in Cocos' scene script loader.
    private trashBin: TrashBin | null = null;
    private isMovingToBin = false;
    private isPlaced = false;
    private bobTween: Tween<Node> | null = null;

    private readonly onDropSuccess = (): void => this.MoveToBin();
    private readonly onBeginDrag = (): void => this.StopIdleBobbing();
    // ItemDraggable invokes this right after a missed drop has been finalized in place.
    private readonly onDropFailFinalized = (): void => this.StartIdleBobbing();
    private readonly onMoveComplete = (): void => {
        if (this.isMovingToBin) this.ArriveAtBin();
    };

    public get IsPlaced(): boolean {
        return this.isPlaced;
    }

    protected onLoad(): void {
        super.onLoad();
        this.trashBin ??= this.FindTrashBin();
        if (!this.trashBin?.IsFull) this.DisableDrop();
        this.SetupDropFailBehaviour();
    }

    /**
     * A missed drop leaves the lid where it was released (then it bobs), above other
     * items, with no break heart. Moving onto the bin keeps the lid in draggingNode too.
     */
    private SetupDropFailBehaviour(): void {
        if (this.itemDraggable) {
            this.itemDraggable.returnToStartOnDragFailed = false;
            this.itemDraggable.spawnBreakHeartOnDropFail = false;
            this.itemDraggable.keepInDraggingNodeOnDropFail = true;
        }
        if (this.itemMoveToTarget && !this.parentToBinOnPlaced) {
            this.itemMoveToTarget.setParentToTarget = false;
            this.itemMoveToTarget.resetParentOnComplete = false;
        }
    }

    protected onEnable(): void {
        this.cacheComponents();
        this.SetupDropFailBehaviour();
        this.itemDraggable?.onDropSuccess.removeListener(this.onDropSuccess);
        this.itemDraggable?.onDropSuccess.addListener(this.onDropSuccess);
        this.itemDraggable?.onBeginDrag.removeListener(this.onBeginDrag);
        this.itemDraggable?.onBeginDrag.addListener(this.onBeginDrag);
        this.itemDraggable?.onReturnToStartComplete.removeListener(this.onDropFailFinalized);
        this.itemDraggable?.onReturnToStartComplete.addListener(this.onDropFailFinalized);
        this.itemMoveToTarget?.node.off(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
        this.itemMoveToTarget?.node.on(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
    }

    protected onDisable(): void {
        this.itemDraggable?.onDropSuccess.removeListener(this.onDropSuccess);
        this.itemDraggable?.onBeginDrag.removeListener(this.onBeginDrag);
        this.itemDraggable?.onReturnToStartComplete.removeListener(this.onDropFailFinalized);
        this.itemMoveToTarget?.node.off(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
        this.StopIdleBobbing();
        this.isMovingToBin = false;
    }

    /** Called by TrashBin once it is full: the lid can now be dropped on the bin. */
    public EnableDrop(bin: TrashBin): void {
        this.trashBin = bin;
        if (this.isPlaced) return;

        if (this.itemDraggable) {
            this.itemDraggable.targetItemType = bin.itemType;
            this.itemDraggable.EnableComponent();
        }
        if (this.itemMoveToTarget) {
            this.itemMoveToTarget.defaultTarget = this.GetLidTargetNode(bin);
        }

        const handTut = HandTutManager.Ins;
        if (handTut) {
            handTut.AddItem(this, true);
            handTut.StartHandTut();
        }
    }

    /** Drops on the bin miss (lid stays in place and bobs) until EnableDrop() is called. */
    public DisableDrop(): void {
        if (this.itemDraggable) {
            this.itemDraggable.targetItemType = ItemType.None;
        }
    }

    /** Called automatically after a successful ItemDraggable drop. */
    public MoveToBin(): void {
        if (this.isMovingToBin || this.isPlaced) return;

        const bin = this.trashBin;
        if (!bin?.IsFull) {
            // Should not happen (drop type is locked until full); treat it like a miss.
            this.itemDraggable?.ReturnToStart(false);
            return;
        }
        if (!this.itemMoveToTarget) {
            console.warn(`[TrashBinLid] Assign ItemMoveToTarget on "${this.node.name}".`);
            return;
        }

        this.isMovingToBin = true;
        this.StopIdleBobbing();
        this.itemDraggable?.DisableComponent();

        // Nắp có thể đang nghiêng do lần thả trượt trước đó (ItemDraggable.ApplyRandomDropRotation).
        // Xoay lại góc ban đầu song song với quãng bay để lúc tới nơi là đậy thẳng.
        // ItemMoveToTarget tự xoay node mỗi frame khi bật rotate360DuringJump, hai bên cùng ghi
        // eulerAngles sẽ giành nhau => chỉ tự xoay khi nó không xoay.
        if (this.restoreRotationOnMoveToBin && !this.itemMoveToTarget.rotate360DuringJump) {
            this.itemDraggable?.RestoreOriginalRotation(this.itemMoveToTarget.duration);
        }

        this.itemMoveToTarget.ExecuteMove2D(this.GetLidTargetNode(bin));
    }

    /** Snaps the lid onto the bin and notifies the bin. */
    public ArriveAtBin(): void {
        this.isMovingToBin = false;
        this.isPlaced = true;

        // Nắp đã đậy lên thùng: tính 1 nước đi.
        GameManager.Ins?.MoveOne();

        // Chốt góc gốc: tween ở MoveToBin() có thể chưa chạy hết nếu quãng bay bị rút ngắn.
        if (this.restoreRotationOnMoveToBin && this.itemDraggable) {
            const euler = this.itemDraggable.OriginalEuler;
            this.node.setRotationFromEuler(euler.x, euler.y, euler.z);
        }

        const bin = this.trashBin;
        if (bin && this.parentToBinOnPlaced && this.node.parent !== bin.node) {
            const worldPosition = this.node.worldPosition.clone();
            const worldScale = this.node.worldScale.clone();
            const worldRotation = this.node.worldRotation.clone();
            this.node.setParent(bin.node);
            this.node.setWorldPosition(worldPosition);
            this.node.setWorldScale(worldScale);
            this.node.setWorldRotation(worldRotation);
        }

        if (this.itemDraggable) {
            this.itemDraggable.targetItemType = ItemType.None;
        }
        this.ItemDone();
        bin?.OnLidPlaced();
    }

    /** Allows the lid to be placed again (used by TrashBin.ResetTrash). */
    public ResetLid(): void {
        this.isMovingToBin = false;
        this.isPlaced = false;
        this.itemDraggable?.EnableComponent();
        this.DisableDrop();
    }

    /** Bobs around the current position until the next drag starts. Not played on spawn. */
    public StartIdleBobbing(): void {
        if (!this.enableIdleBobbing || !this.node.isValid || this.isMovingToBin || this.isPlaced) return;
        this.StopIdleBobbing();

        const startLocalPos = this.node.position.clone();
        const topPos = new Vec3(startLocalPos.x, startLocalPos.y + this.idleBobbingDistance, startLocalPos.z);
        this.bobTween = tween(this.node)
            .to(this.idleBobbingDuration * 0.5, { position: topPos }, { easing: 'sineInOut' })
            .to(this.idleBobbingDuration * 0.5, { position: startLocalPos }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    public StopIdleBobbing(): void {
        this.bobTween?.stop();
        this.bobTween = null;
    }

    private GetLidTargetNode(bin: TrashBin): Node {
        return bin.trashBinLidPos?.isValid ? bin.trashBinLidPos : bin.node;
    }

    private FindTrashBin(): TrashBin | null {
        const bins = (this.node.scene?.getComponentsInChildren('TrashBin') ?? []) as TrashBin[];
        return bins.find(bin => bin.isValid && bin.node.activeInHierarchy) ?? bins[0] ?? null;
    }
}
