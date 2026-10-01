import { _decorator, Node, Tween, tween, UITransform, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { CleaningSoundMode } from './CleaningSoundMode';

const { ccclass, property } = _decorator;

enum SmallTrashState {
    Idle,
    Sucking,
    Done,
}

class SmallTrashTarget {
    public state = SmallTrashState.Idle;
    constructor(public readonly node: Node) { }
}

/**
 * Máy hút bụi.
 * - Kéo máy, scanPoint (TrashScanPos) quét trúng rác nhỏ -> rác rung, bay vào trashInPos, scale về 0 rồi tắt.
 * - Hút hết rác -> ItemCleanManager.ItemCleanDone (CleanToolSlide lo phần bay xuống).
 */
@ccclass('Vacuum')
export class Vacuum extends Item {
    @property({ type: Node, tooltip: 'Điểm quét rác ở đầu hút (TrashScanPos).' })
    public scanPoint: Node | null = null;

    @property({ tooltip: 'Nới rộng vùng UITransform của rác khi kiểm tra quét trúng (pixel).' })
    public scanRadius = 40;

    @property({ type: Node, tooltip: 'Điểm rác bị hút vào (TrashInPos). Nên đặt trước sprite máy hút trong hierarchy để rác bị che khi bay vào.' })
    public trashInPos: Node | null = null;

    @property({ type: Node, tooltip: 'Node cha chứa rác nhỏ (SmallTrash). Dùng toàn bộ con nếu danh sách trashes để trống.' })
    public trashRoot: Node | null = null;

    @property({ type: [Node], tooltip: 'Danh sách rác cần hút. Để trống sẽ lấy toàn bộ con của trashRoot.' })
    public trashes: Node[] = [];

    @property({ min: 0, tooltip: 'Thời gian rác rung trước khi bị hút (giây).' })
    public shakeDuration = 0.25;

    @property({ tooltip: 'Góc rung tối đa (độ).' })
    public shakeAngle = 12;

    @property({ min: 0.01, tooltip: 'Thời gian rác bay vào máy hút (giây).' })
    public suckDuration = 0.3;

    @property({ tooltip: 'Phát âm thanh mỗi khi hút trúng rác.' })
    public playSuckSound = true;

    @property({ type: Enum(FxType) })
    public suckFxType: FxType = FxType.Clean2;

    @property({ tooltip: 'Loop sound khi đang kéo máy hút.' })
    public playDragSound = true;

    @property({ type: Enum(FxType) })
    public dragFxType: FxType = FxType.BlowDryer;

    @property({ type: Enum(CleaningSoundMode), tooltip: 'Khi nào loop sound được bật.' })
    public dragSoundMode: CleaningSoundMode = CleaningSoundMode.Always;

    @property({ type: ItemCleanManager, tooltip: 'Để trống sẽ dùng ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi 1 rác đã bị hút xong.' })
    public onTrashSucked: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi đã hút hết rác.' })
    public onAllTrashSucked: Ply_Event = new Ply_Event();

    private _targets: SmallTrashTarget[] = [];
    private _isDragging = false;
    private _suckedInDrag = false;
    private _isPlayingDragSound = false;
    private _isCompleted = false;
    private readonly _tempWorld = new Vec3();
    private readonly _tempLocal = new Vec3();

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDropFail = () => this.onDropFail();
    private _boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);

        const nodes = this.trashes.length > 0 ? this.trashes : (this.trashRoot?.children ?? []);
        this._targets = nodes.filter(node => node?.isValid).map(node => new SmallTrashTarget(node));
    }

    protected onEnable(): void {
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        const draggable = this.itemDraggable;
        if (!draggable) return;
        draggable.onBeginDrag.addListener(this._boundOnDragStart);
        draggable.onDropFail.addListener(this._boundOnDropFail);
        draggable.onDropSuccess.addListener(this._boundOnDragEnd);
        draggable.onReturnToStartComplete.addListener(this._boundOnDragEnd);
    }

    protected onDisable(): void {
        const draggable = this.itemDraggable;
        if (draggable) {
            draggable.onBeginDrag.removeListener(this._boundOnDragStart);
            draggable.onDropFail.removeListener(this._boundOnDropFail);
            draggable.onDropSuccess.removeListener(this._boundOnDragEnd);
            draggable.onReturnToStartComplete.removeListener(this._boundOnDragEnd);
        }
        this.onDragEnd();
    }

    public resetInEditor(): void {
        super.resetInEditor();
        if (!this.onTrashSucked) this.onTrashSucked = new Ply_Event();
        if (!this.onAllTrashSucked) this.onAllTrashSucked = new Ply_Event();
    }

    /** HandTut: chỉ vào rác nhỏ kế tiếp chưa bị hút. */
    public GetHandTutTarget(): Node | null {
        return this._targets.find(t => t.state === SmallTrashState.Idle && t.node.activeInHierarchy)?.node ?? null;
    }

    private onDragStart(): void {
        if (!this.isCurrentCleanItem()) return;
        this._isDragging = true;
        this._suckedInDrag = false;
        this.updateDragSound(false);
        this.checkSuck();
    }

    private onDragEnd(): void {
        this._isDragging = false;
        this.stopDragSound();
    }

    private onDropFail(): void {
        this.onDragEnd();
        const draggable = this.itemDraggable;
        if (!draggable) return;

        // Đã xong: không BreakHeart. Nếu CleanToolSlide đang ép thả để bay xuống thì giữ nguyên vị trí.
        if (this._isCompleted) {
            draggable.ConsumeCurrentDropFail();
            // Tool ở lại scene (không CleanToolSlide ép thả) thì quay về chỗ cũ, không BreakHeart.
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
            return;
        }

        if (this._suckedInDrag) {
            draggable.ConsumeCurrentDropFail();
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
        }
    }

    protected lateUpdate(): void {
        if (!this._isDragging) return;
        if (!this.itemDraggable?.IsDragging || !this.isCurrentCleanItem()) {
            this.onDragEnd();
            return;
        }
        this.checkSuck();
    }

    private checkSuck(): void {
        if (this._isCompleted) return;

        const point = this.scanPoint ?? this.node;
        point.getWorldPosition(this._tempWorld);

        let isOverTrash = false;
        for (const target of this._targets) {
            if (target.state !== SmallTrashState.Idle || !target.node.activeInHierarchy) continue;
            if (!this.isPointOnNode(this._tempWorld, target.node, this.scanRadius)) continue;
            isOverTrash = true;
            this.suck(target);
        }
        this.updateDragSound(isOverTrash);
    }

    private suck(target: SmallTrashTarget): void {
        target.state = SmallTrashState.Sucking;
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(target.node.worldPosition);
        this._suckedInDrag = true;
        if (this.playSuckSound) Ply_SoundManager.Ins?.PlayFx(this.suckFxType);

        const node = target.node;
        const baseAngle = node.angle;
        const step = Math.max(0.01, this.shakeDuration / 4);
        Tween.stopAllByTarget(node);

        tween(node)
            .to(step, { angle: baseAngle + this.shakeAngle })
            .to(step, { angle: baseAngle - this.shakeAngle })
            .to(step, { angle: baseAngle + this.shakeAngle * 0.5 })
            .to(step, { angle: baseAngle })
            .call(() => this.flyIntoVacuum(target))
            .start();
    }

    private flyIntoVacuum(target: SmallTrashTarget): void {
        const node = target.node;
        const holder = this.trashInPos ?? this.node;
        // Gán TrashInPos làm cha để rác bay theo máy hút khi người chơi vẫn đang kéo.
        node.setParent(holder, true);

        tween(node)
            .to(this.suckDuration, { position: new Vec3(), scale: new Vec3(0, 0, 1) }, { easing: 'quadIn' })
            .call(() => {
                node.active = false;
                target.state = SmallTrashState.Done;
                this.onTrashSucked.invoke(node);
                if (!this._isCompleted && this._targets.every(t => t.state === SmallTrashState.Done)) {
                    this.onAllSucked();
                }
            })
            .start();
    }

    private onAllSucked(): void {
        this._isCompleted = true;
        this.isDone = true;
        this.stopDragSound();
        this.onAllTrashSucked.invoke();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
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
        const scale = Math.max(0.0001, Math.abs(node.worldScale.x));
        const pad = padding / scale;
        transform.convertToNodeSpaceAR(worldPoint, this._tempLocal);
        const left = -transform.anchorX * transform.width - pad;
        const bottom = -transform.anchorY * transform.height - pad;
        return this._tempLocal.x >= left && this._tempLocal.x <= left + transform.width + pad * 2
            && this._tempLocal.y >= bottom && this._tempLocal.y <= bottom + transform.height + pad * 2;
    }

    private updateDragSound(isOverTrash: boolean): void {
        if (!this.playDragSound || (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTrash)) {
            this.stopDragSound();
            return;
        }
        if (this._isPlayingDragSound || !Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.dragFxType);
        this._isPlayingDragSound = true;
    }

    private stopDragSound(): void {
        if (!this._isPlayingDragSound) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.dragFxType);
        this._isPlayingDragSound = false;
    }

    /** Không spawn BreakHeart nếu lượt kéo này đã hút được rác. */
    public SpawnBreakHeart(): void {
        if (!this._suckedInDrag && !this._isCompleted) super.SpawnBreakHeart();
    }

    public OnDragFailReturnComplete(): void {
        if (!this._suckedInDrag && !this._isCompleted) super.OnDragFailReturnComplete();
    }
}
