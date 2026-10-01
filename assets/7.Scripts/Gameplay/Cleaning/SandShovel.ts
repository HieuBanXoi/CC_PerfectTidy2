import { _decorator, Node, Tween, tween, UITransform, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { TrashBag } from './TrashBag';

const { ccclass, property } = _decorator;

enum TrashState {
    InSand,
    OnShovel,
    ToBag,
    Done,
}

/** Trạng thái + vị trí gốc của một rác trong hộp cát. */
class SandTrash {
    public state = TrashState.InSand;
    public readonly parent: Node | null;
    public readonly siblingIndex: number;
    public readonly localPos: Vec3;
    public readonly localScale: Vec3;
    public readonly angle: number;

    constructor(public readonly node: Node) {
        this.parent = node.parent;
        this.siblingIndex = node.getSiblingIndex();
        this.localPos = node.position.clone();
        this.localScale = node.scale.clone();
        this.angle = node.angle;
    }
}

/**
 * Xẻng hót rác cát.
 * - Kéo xẻng quét trúng 1 rác (trashes) -> rác bay lên, gán trashPos làm cha.
 * - Đang mang rác mà kéo trúng TrashBag -> rác nhảy vào TrashDropPos, scale về 0 và biến mất.
 * - Thả tay khi đang mang rác ngoài túi -> rác quay về chỗ cũ.
 * - Hót hết rác -> túi đóng (TrashClose) -> ItemCleanManager.ItemCleanDone (CleanToolSlide lo phần bay xuống).
 */
@ccclass('SandShovel')
export class SandShovel extends Item {
    @property({ type: Node, tooltip: 'Vị trí rác nằm trên lưỡi xẻng (TrashPos). Rác hót được sẽ nhận node này làm cha.' })
    public trashPos: Node | null = null;

    @property({ type: Node, tooltip: 'Điểm quét rác. Để trống sẽ dùng trashPos.' })
    public scoopPoint: Node | null = null;

    @property({ tooltip: 'Nới rộng vùng UITransform của rác khi kiểm tra quét trúng (pixel).' })
    public scoopRadius = 30;

    @property({ type: [Node], tooltip: 'Danh sách rác trong hộp cát (TrashInSandBox).' })
    public trashes: Node[] = [];

    @property({ type: TrashBag, tooltip: 'Túi rác nhận rác.' })
    public trashBag: TrashBag | null = null;

    @property({ min: 0.01, tooltip: 'Thời gian rác bay lên lưỡi xẻng (giây).' })
    public scoopDuration = 0.25;

    @property({ min: 0.01, tooltip: 'Thời gian rác quay về chỗ cũ khi thả tay (giây).' })
    public returnDuration = 0.3;

    @property({ min: 0, tooltip: 'Đợi thêm sau khi túi đóng rồi mới báo ItemCleanDone (giây).' })
    public doneDelay = 0.15;

    @property({ tooltip: 'Phát âm thanh khi hót trúng rác.' })
    public playScoopSound = true;

    @property({ type: Enum(FxType) })
    public scoopFxType: FxType = FxType.Clean2;

    @property({ type: ItemCleanManager, tooltip: 'Để trống sẽ dùng ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi hót được 1 rác lên xẻng.' })
    public onTrashScooped: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi 1 rác đã vào túi.' })
    public onTrashInBag: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi đã hót hết rác.' })
    public onAllTrashCleared: Ply_Event = new Ply_Event();

    private _trashStates: SandTrash[] = [];
    private _carrying: SandTrash | null = null;
    private _isDragging = false;
    private _interactedInDrag = false;
    private _allCleared = false;
    private readonly _tempWorld = new Vec3();
    private readonly _tempLocal = new Vec3();

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDropFail = () => this.onDropFail();
    private _boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        this._trashStates = this.trashes.filter(node => node?.isValid).map(node => new SandTrash(node));
    }

    protected onEnable(): void {
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        const draggable = this.itemDraggable;
        if (!draggable) return;
        draggable.onBeginDrag.addListener(this._boundOnDragStart);
        draggable.onDropFail.addListener(this._boundOnDropFail);
        draggable.onDropSuccess.addListener(this._boundOnDragEnd);
    }

    protected onDisable(): void {
        const draggable = this.itemDraggable;
        if (draggable) {
            draggable.onBeginDrag.removeListener(this._boundOnDragStart);
            draggable.onDropFail.removeListener(this._boundOnDropFail);
            draggable.onDropSuccess.removeListener(this._boundOnDragEnd);
        }
        this._isDragging = false;
    }

    public resetInEditor(): void {
        super.resetInEditor();
        if (!this.onTrashScooped) this.onTrashScooped = new Ply_Event();
        if (!this.onTrashInBag) this.onTrashInBag = new Ply_Event();
        if (!this.onAllTrashCleared) this.onAllTrashCleared = new Ply_Event();
    }

    /** HandTut: đang mang rác -> chỉ vào túi, ngược lại chỉ vào rác kế tiếp. */
    public GetHandTutTarget(): Node | null {
        if (this._carrying && this.trashBag?.node.activeInHierarchy) return this.trashBag.node;
        return this._trashStates.find(t => t.state === TrashState.InSand && t.node.activeInHierarchy)?.node ?? null;
    }

    private onDragStart(): void {
        this._isDragging = true;
        this._interactedInDrag = false;
        this.checkInteraction();
    }

    private onDragEnd(): void {
        this._isDragging = false;
    }

    private onDropFail(): void {
        this._isDragging = false;
        const draggable = this.itemDraggable;
        if (!draggable) return;

        // Đã xong: không BreakHeart. Nếu CleanToolSlide đang ép thả để bay xuống thì giữ nguyên vị trí.
        if (this._allCleared) {
            draggable.ConsumeCurrentDropFail();
            // Tool ở lại scene (không CleanToolSlide ép thả) thì quay về chỗ cũ, không BreakHeart.
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
            return;
        }

        if (this._carrying) this.returnTrashToSand(this._carrying);

        // Lượt kéo có hót trúng rác thì xẻng về chỗ cũ không hiện BreakHeart.
        if (this._interactedInDrag) {
            draggable.ConsumeCurrentDropFail();
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
        }
    }

    protected lateUpdate(): void {
        if (!this._isDragging) return;
        if (!this.itemDraggable?.IsDragging) {
            this._isDragging = false;
            return;
        }
        this.checkInteraction();
    }

    private checkInteraction(): void {
        if (this._allCleared || !this.isCurrentCleanItem()) return;

        if (this._carrying) {
            const checkPoint = this.trashPos ?? this.node;
            if (this.trashBag?.ContainsWorldPoint(checkPoint.worldPosition)) {
                this.dropToBag(this._carrying);
            }
            return;
        }

        const point = this.scoopPoint ?? this.trashPos ?? this.node;
        point.getWorldPosition(this._tempWorld);
        const hit = this._trashStates.find(t => t.state === TrashState.InSand
            && t.node.activeInHierarchy && this.isPointOnNode(this._tempWorld, t.node, this.scoopRadius));
        if (hit) this.scoop(hit);
    }

    private scoop(trash: SandTrash): void {
        const holder = this.trashPos ?? this.node;
        trash.state = TrashState.OnShovel;
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(trash.node.worldPosition);
        this._carrying = trash;
        this._interactedInDrag = true;

        Tween.stopAllByTarget(trash.node);
        trash.node.setParent(holder, true);
        tween(trash.node)
            .to(this.scoopDuration, { position: new Vec3(), angle: 0 }, { easing: 'quadOut' })
            .start();

        if (this.playScoopSound) Ply_SoundManager.Ins?.PlayFx(this.scoopFxType);
        this.onTrashScooped.invoke(trash.node);
    }

    private dropToBag(trash: SandTrash): void {
        if (!this.trashBag) return;
        trash.state = TrashState.ToBag;
        this._carrying = null;

        this.trashBag.ReceiveTrash(trash.node, () => {
            trash.state = TrashState.Done;
            this.onTrashInBag.invoke(trash.node);
            if (this._trashStates.every(t => t.state === TrashState.Done)) this.onAllCleared();
        });

        // Chặn hót tiếp trong lúc đợi rác cuối cùng bay vào túi.
        if (this._trashStates.every(t => t.state === TrashState.ToBag || t.state === TrashState.Done)) {
            this._allCleared = true;
        }
    }

    private returnTrashToSand(trash: SandTrash): void {
        this._carrying = null;
        trash.state = TrashState.InSand;
        const node = trash.node;
        Tween.stopAllByTarget(node);

        if (trash.parent?.isValid) {
            node.setParent(trash.parent, true);
            if (trash.siblingIndex < trash.parent.children.length) node.setSiblingIndex(trash.siblingIndex);
        }
        tween(node)
            .to(this.returnDuration, { position: trash.localPos, scale: trash.localScale, angle: trash.angle }, { easing: 'quadOut' })
            .start();
    }

    private onAllCleared(): void {
        this._allCleared = true;
        this.onAllTrashCleared.invoke();

        const finish = () => this.scheduleOnce(() => {
            this.isDone = true;
            (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
        }, this.doneDelay);

        if (this.trashBag) {
            this.trashBag.Close(finish);
        } else {
            finish();
        }
    }

    private isCurrentCleanItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    private isPointOnNode(worldPoint: Vec3, node: Node, padding: number): boolean {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return Vec3.distance(worldPoint, node.worldPosition) <= padding;
        }
        // padding tính theo world; quy đổi sang local theo scale của node.
        const scale = Math.max(0.0001, Math.abs(node.worldScale.x));
        const pad = padding / scale;
        transform.convertToNodeSpaceAR(worldPoint, this._tempLocal);
        const left = -transform.anchorX * transform.width - pad;
        const bottom = -transform.anchorY * transform.height - pad;
        return this._tempLocal.x >= left && this._tempLocal.x <= left + transform.width + pad * 2
            && this._tempLocal.y >= bottom && this._tempLocal.y <= bottom + transform.height + pad * 2;
    }

    /** Không spawn BreakHeart nếu lượt kéo này đã hót trúng rác. */
    public SpawnBreakHeart(): void {
        if (!this._interactedInDrag && !this._allCleared) super.SpawnBreakHeart();
    }

    public OnDragFailReturnComplete(): void {
        if (!this._interactedInDrag && !this._allCleared) super.OnDragFailReturnComplete();
    }
}
