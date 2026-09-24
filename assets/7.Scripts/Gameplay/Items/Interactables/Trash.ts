import { _decorator, Enum, Node, Tween, tween, Vec3 } from 'cc';
import { Item } from '../Components/Item';
import { ItemMoveToTarget } from '../Components/ItemMoveToTarget';
import { TrashBin } from './TrashBin';
import { GameManager } from '../../Systems/GameManager';
import { FxType, Ply_SoundManager } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';

const { ccclass, property } = _decorator;

/**
 * A piece of trash: drop it on the TrashBin, it shrinks into the bin, hides
 * itself and calls TrashBin.AddTrash(). The bin is resolved automatically at
 * runtime so scenes only need the Trash + ItemDraggable + ItemMoveToTarget.
 */
@ccclass('Trash')
export class Trash extends Item {
    @property({ type: TrashBin, tooltip: 'Bin this trash goes into. Leave empty to find the first active TrashBin in the scene.' })
    public trashBin: TrashBin | null = null;

    @property({ min: 0, tooltip: 'ItemMoveToTarget.endScaleMultiplier applied when moving into the bin (0 = shrink away).' })
    public endScaleMultiplier = 0;

    @property({ tooltip: 'Phát âm thanh ngay lúc thả trúng thùng rác (trước khi rác bay vào thùng)' })
    public playSoundOnDropSuccess = true;

    @property({ type: Enum(FxType), tooltip: 'Âm thanh phát khi thả trúng thùng rác' })
    public dropSuccessFxType: FxType = FxType.Swipe;

    @property({ tooltip: 'Phát sound Aha khi rác đã bay vào thùng xong' })
    public playAhaOnArrive = true;

    @property({ type: Ply_Event, tooltip: 'Gọi khi rác bay vào thùng xong (ItemMoveToTarget complete)' })
    public onArriveAtBin: Ply_Event = new Ply_Event();

    @property({ tooltip: 'Bob up and down (like ItemSnap) after a missed drop. The trash stays where it was dropped.' })
    public enableIdleBobbing = true;

    @property({ min: 0, tooltip: 'Idle bobbing height in UI units.' })
    public idleBobbingDistance = 15;

    @property({ min: 0.1, tooltip: 'Seconds for one full bob cycle.' })
    public idleBobbingDuration = 1.5;

    private isMovingToBin = false;
    private bobTween: Tween<Node> | null = null;

    private readonly onDropSuccess = (target?: Node): void => this.MoveToBin(target ?? null);
    private readonly onBeginDrag = (): void => this.StopIdleBobbing();
    // ItemDraggable invokes this right after a missed drop has been finalized in place.
    private readonly onDropFailFinalized = (): void => this.StartIdleBobbing();
    private readonly onMoveComplete = (): void => {
        if (this.isMovingToBin) this.ArriveAtBin();
    };

    protected onLoad(): void {
        super.onLoad();
        this.SetupBinTarget();
    }

    protected onEnable(): void {
        this.cacheComponents();
        this.SetupBinTarget();

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

    /** Points the draggable/move components at the bin and configures the shrink-on-move. */
    public SetupBinTarget(): void {
        const bin = this.ResolveTrashBin();
        if (!bin) {
            console.warn(`[Trash] No TrashBin found for "${this.node.name}".`);
            return;
        }

        bin.RegisterTrash(this);

        if (this.itemDraggable) {
            this.itemDraggable.targetItemType = bin.itemType;
            // A missed drop leaves the trash where it was released (then it bobs),
            // with no break-heart feedback.
            this.itemDraggable.returnToStartOnDragFailed = false;
            this.itemDraggable.spawnBreakHeartOnDropFail = false;
            // Stay in draggingNode after a miss so the trash renders above other items.
            this.itemDraggable.keepInDraggingNodeOnDropFail = true;
        }
        if (this.itemMoveToTarget) {
            this.itemMoveToTarget.defaultTarget = bin.GetTrashInNode();
            this.itemMoveToTarget.scaleOnMove = true;
            this.itemMoveToTarget.endScaleMultiplier = this.endScaleMultiplier;
        }
    }

    /** Called automatically after a successful ItemDraggable drop. */
    public MoveToBin(dropTarget: Node | null = null): void {
        if (this.isMovingToBin) return;

        const droppedBin = dropTarget?.getComponent(TrashBin) ?? null;
        if (droppedBin) this.trashBin = droppedBin;
        const bin = this.ResolveTrashBin();
        if (!bin || !this.itemMoveToTarget) {
            console.warn(`[Trash] Assign ItemMoveToTarget and a TrashBin for "${this.node.name}".`);
            return;
        }

        // Phát ngay tại đây chứ không đợi ArriveAtBin: tiếng phải khớp với khoảnh khắc người
        // chơi buông tay, không phải lúc rác đã bay xong vào thùng.
        if (this.playSoundOnDropSuccess) {
            Ply_SoundManager.Ins?.PlayFx(this.dropSuccessFxType);
        }

        this.isMovingToBin = true;
        this.itemDraggable?.DisableComponent();
        this.itemMoveToTarget.ExecuteMove2D(bin.GetTrashInNode());
    }

    /** Hides this trash and registers it with the bin after the move finishes. */
    public ArriveAtBin(): void {
        this.isMovingToBin = false;
        this.StopIdleBobbing();

        // Rác đã vào thùng: tính 1 nước đi.
        GameManager.Ins?.MoveOne();
        if (this.playAhaOnArrive) {
            Ply_SoundManager.Ins?.PlayFx(FxType.Aha);
        }
        this.onArriveAtBin?.invoke();
        this.ItemDone();
        this.node.active = false;
        this.trashBin?.AddTrash(this);
    }

    /** Bobs around the current position until the next drag starts. Not played on spawn. */
    public StartIdleBobbing(): void {
        if (!this.enableIdleBobbing || !this.node.isValid || this.isMovingToBin) return;
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

    private ResolveTrashBin(): TrashBin | null {
        if (this.trashBin?.isValid) return this.trashBin;

        const bins = (this.node.scene?.getComponentsInChildren(TrashBin) ?? []) as TrashBin[];
        this.trashBin = bins.find(bin => bin.isValid && bin.node.activeInHierarchy) ?? bins[0] ?? null;
        return this.trashBin;
    }
}
