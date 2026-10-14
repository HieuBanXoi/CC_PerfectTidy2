import { _decorator, Enum, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { InputManager } from '../../Core/Managers/InputManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CameraFace } from './CameraFace';
import { CameraFaceController } from './CameraFaceController';

const { ccclass, property } = _decorator;

/**
 * Lớp nền cho các tool làm sạch máy ảnh.
 * - Chỉ hoạt động khi là item hiện tại của ItemCleanManager.
 * - Cùng 1 tool có thể xuất hiện nhiều lần trong ItemCleanManager (mỗi mặt máy ảnh 1 lần);
 *   OnCleanStepStart được gọi mỗi khi tool tới lượt để reset trạng thái theo mặt hiện tại.
 * - Lớp con override: onStepStart, onToolDrag (trả về true khi đang làm sạch), onToolDragEnd, getHintTarget.
 */
@ccclass('CameraCleanTool')
export class CameraCleanTool extends Item {
    @property({ type: Node, tooltip: 'Điểm làm sạch của tool (CleanPos). Để trống: node tool.' })
    public cleanPoint: Node | null = null;

    @property({ type: CameraFaceController, tooltip: 'Để trống: CameraFaceController.Ins.' })
    public faceController: CameraFaceController | null = null;

    @property({ type: ItemCleanManager, tooltip: 'Để trống: ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ tooltip: 'Làm sạch xong thì tự nhả tay và quay về chỗ cũ.' })
    public returnOnComplete = true;

    @property({ tooltip: 'Spawn heart khi xong lượt của tool này.' })
    public spawnHeartOnDone = true;

    @property({ tooltip: 'Phát sound hoàn thành (ItemCleanManager.itemCleanDoneFxType) khi xong lượt của tool này.' })
    public playDoneSound = true;

    @property({ tooltip: 'Khi kéo: xoay tool cho đầu làm sạch (cleanPoint) chỉ thẳng lên trên; thả tay xoay về góc cũ.' })
    public rotateUpOnDrag = false;

    @property({ min: 0.01, tooltip: 'Thời gian xoay khi bắt đầu kéo / thả tay (giây).' })
    public rotateDuration = 0.15;

    @property({ tooltip: 'Phát loop sound khi đang làm sạch.' })
    public playLoopSound = true;

    @property({ min: 0, tooltip: 'Ngừng làm sạch bao lâu (giây) mới tắt loop sound, tránh tiếng bị ngắt quãng.' })
    public loopHoldTime = 0.25;

    @property({ type: Enum(FxType) })
    public loopFxType: FxType = FxType.Clean1;

    protected _isDragging = false;
    protected _actedInDrag = false;
    protected _completed = false;
    protected readonly _point = new Vec3();
    protected readonly _lastPoint = new Vec3();
    protected readonly _dragStartWorld = new Vec3();
    private _isPlayingLoop = false;
    private _skipReturnOnce = false;
    private _loopIdleTime = 0;
    private readonly _tempLocal = new Vec3();

    private _restAngle = 0;
    private _isRotatedUp = false;
    private readonly _angleState = { angle: 0 };

    private _boundDragStart = () => { this.rotateUp(); this.handleDragStart(); };
    private _boundDropFail = () => { this.handleDropFail(); this.rotateBack(); };
    private _boundDragEnd = () => { this.handleDragEnd(); this.rotateBack(); };

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        this._restAngle = this.node.angle;
    }

    /** Góc node để vector node -> cleanPoint chỉ thẳng lên (90 độ world). */
    private getUpAngle(): number | null {
        const point = this.cleanPoint;
        if (!point || point.parent !== this.node) return null;
        const p = point.position;
        if (p.x === 0 && p.y === 0) return null;
        const localDeg = Math.atan2(p.y, p.x) * 180 / Math.PI;
        const parentDeg = this.node.parent ? this.getParentWorldAngle() : 0;
        let target = 90 - localDeg - parentDeg;
        // Xoay theo đường ngắn nhất từ góc hiện tại.
        while (target - this.node.angle > 180) target -= 360;
        while (target - this.node.angle < -180) target += 360;
        return target;
    }

    private getParentWorldAngle(): number {
        const euler = new Vec3();
        this.node.parent!.worldRotation.getEulerAngles(euler);
        return euler.z;
    }

    private rotateUp(): void {
        if (!this.rotateUpOnDrag || this._isRotatedUp) return;
        const target = this.getUpAngle();
        if (target === null) return;
        this._isRotatedUp = true;
        this.tweenAngle(target);
    }

    private rotateBack(): void {
        if (!this._isRotatedUp) return;
        this._isRotatedUp = false;
        this.tweenAngle(this._restAngle);
    }

    /** Tween trên object riêng: ItemDraggable dừng mọi tween của node khi quay về chỗ cũ. */
    private tweenAngle(target: number): void {
        Tween.stopAllByTarget(this._angleState);
        this._angleState.angle = this.node.angle;
        tween(this._angleState)
            .to(this.rotateDuration, { angle: target }, {
                easing: 'sineOut',
                onUpdate: () => { if (this.node.isValid) this.node.angle = this._angleState.angle; },
            })
            .start();
    }

    protected onEnable(): void {
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        const draggable = this.itemDraggable;
        if (!draggable) return;
        draggable.onBeginDrag.addListener(this._boundDragStart);
        draggable.onDropFail.addListener(this._boundDropFail);
        draggable.onDropSuccess.addListener(this._boundDragEnd);
        draggable.onReturnToStartComplete.addListener(this._boundDragEnd);
    }

    protected onDisable(): void {
        const draggable = this.itemDraggable;
        if (draggable) {
            draggable.onBeginDrag.removeListener(this._boundDragStart);
            draggable.onDropFail.removeListener(this._boundDropFail);
            draggable.onDropSuccess.removeListener(this._boundDragEnd);
            draggable.onReturnToStartComplete.removeListener(this._boundDragEnd);
        }
        if (this._isDragging) this.handleDragEnd();
    }

    // ---------------- Gọi từ ItemCleanManager / HandTut ----------------

    /** ItemCleanManager gọi mỗi khi tool tới lượt (kể cả lượt lặp lại ở mặt khác). */
    public OnCleanStepStart(): void {
        this._completed = false;
        this.isDone = false;
        this.onStepStart();
    }

    public GetHandTutTarget(): Node | null {
        return this.getHintTarget();
    }

    /** ItemCleanManager hỏi trước khi spawn heart cho lượt vừa xong. */
    public ShouldSpawnHeartOnDone(): boolean {
        return this.spawnHeartOnDone;
    }

    /** ItemCleanManager hỏi trước khi phát sound hoàn thành cho lượt vừa xong. */
    public ShouldPlayDoneSound(): boolean {
        return this.playDoneSound;
    }

    // ---------------- Hook cho lớp con ----------------

    protected onStepStart(): void { }
    protected onToolDragStart(): void { }
    /** Trả về true khi frame này tool đang làm sạch trúng. */
    protected onToolDrag(_dt: number): boolean { return false; }
    protected onToolDragEnd(): void { }
    /** Trả về true nếu lớp con tự xử lý drop fail (base sẽ không làm gì thêm). */
    protected onToolDropFail(): boolean { return false; }
    protected getHintTarget(): Node | null { return null; }

    // ---------------- Helper ----------------

    protected get Face(): CameraFace | null {
        return (this.faceController ?? CameraFaceController.Ins)?.CurrentFace ?? null;
    }

    protected get Manager(): ItemCleanManager | null {
        return this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
    }

    protected get IsCompleted(): boolean {
        return this._completed;
    }

    /** Xong bước: báo ItemCleanManager. */
    protected Complete(): void {
        if (this._completed) return;
        this._completed = true;
        this.isDone = true;
        this.stopLoop();
        this.Manager?.ItemCleanDone();

        const skipReturn = this._skipReturnOnce;
        this._skipReturnOnce = false;
        if (this.returnOnComplete && !skipReturn) this.releaseAndReturn();
    }

    /** Lần Complete kế tiếp không tự nhả tay (ví dụ rút khăn xong lau luôn trong cùng lần kéo). */
    protected SkipReturnOnNextComplete(): void {
        this._skipReturnOnce = true;
    }

    /**
     * Xong việc mà người chơi vẫn đang cầm: nhả tay ngay. Drop fail của tool đã xong sẽ
     * tự về chỗ cũ (không BreakHeart) trong handleDropFail.
     */
    private releaseAndReturn(): void {
        const draggable = this.itemDraggable;
        if (!draggable?.IsDragging) return;
        const input = InputManager.Ins as InputManager | null;
        if (input?.IsDraggingItem()) {
            input.EndInteraction();
        } else {
            draggable.EndDrag();
        }
    }

    protected isPointInside(worldPoint: Vec3, node: Node | null, worldPadding = 0): boolean {
        const transform = node?.getComponent(UITransform);
        if (!node || !transform || !node.activeInHierarchy) return false;
        const scale = Math.max(0.0001, Math.abs(node.worldScale.x));
        const pad = worldPadding / scale;
        transform.convertToNodeSpaceAR(worldPoint, this._tempLocal);
        const left = -transform.anchorX * transform.width - pad;
        const bottom = -transform.anchorY * transform.height - pad;
        return this._tempLocal.x >= left && this._tempLocal.x <= left + transform.width + pad * 2
            && this._tempLocal.y >= bottom && this._tempLocal.y <= bottom + transform.height + pad * 2;
    }

    // ---------------- Drag plumbing ----------------

    private isCurrentCleanItem(): boolean {
        const manager = this.Manager;
        if (!manager) return true;
        return this.onProcess && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /** Lớp con override = true để vẫn thao tác được khi chưa tới lượt (ví dụ xịt ướt giấy). */
    protected get CanWorkWhenNotCurrent(): boolean {
        return false;
    }

    /** ItemCleanManager hỏi lúc bắt đầu kéo: đang thao tác hợp lệ trước lượt thì không phạt. */
    public CanWorkOffTurnNow(): boolean {
        return !this.isCurrentCleanItem() && this.CanWorkWhenNotCurrent;
    }

    /** Tool đang là lượt hiện tại của ItemCleanManager. */
    protected get IsCurrentStep(): boolean {
        return this.isCurrentCleanItem();
    }

    private canWorkNow(): boolean {
        return this.isCurrentCleanItem() ? !this._completed : this.CanWorkWhenNotCurrent;
    }

    private handleDragStart(): void {
        if (!this.canWorkNow()) return;
        this._isDragging = true;
        this._actedInDrag = false;
        (this.cleanPoint ?? this.node).getWorldPosition(this._lastPoint);
        this.node.getWorldPosition(this._dragStartWorld);
        this.onToolDragStart();
    }

    protected lateUpdate(dt: number): void {
        if (!this._isDragging) return;
        if (!this.itemDraggable?.IsDragging || !this.canWorkNow()) {
            this.handleDragEnd();
            return;
        }

        (this.cleanPoint ?? this.node).getWorldPosition(this._point);
        const acting = this.onToolDrag(dt);
        // onToolDrag có thể vừa làm xong (Complete -> tự nhả tay): không bật lại loop sound.
        if (!this._isDragging || this._completed) {
            this.stopLoop();
            return;
        }
        if (acting) {
            this._actedInDrag = true;
            this._loopIdleTime = 0;
            this.startLoop();
            this.Manager?.ReportCleanAction(this._point);
        } else {
            // Giữ tiếng thêm loopHoldTime để không bị ngắt quãng khi tay khựng 1-2 frame.
            this._loopIdleTime += dt;
            if (this._loopIdleTime >= this.loopHoldTime) this.stopLoop();
        }
        this._lastPoint.set(this._point);
    }

    private handleDragEnd(): void {
        if (!this._isDragging) return;
        this._isDragging = false;
        this.stopLoop();
        this.onToolDragEnd();
    }

    private handleDropFail(): void {
        const wasDragging = this._isDragging;
        this.handleDragEnd();
        if (wasDragging && this.onToolDropFail()) return;

        const draggable = this.itemDraggable;
        if (!draggable) return;
        // Đã làm sạch được trong lượt kéo (hoặc đã xong bước): về chỗ cũ, không BreakHeart.
        if (this._completed || this._actedInDrag) {
            draggable.ConsumeCurrentDropFail();
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
        }
    }

    private startLoop(): void {
        if (!this.playLoopSound || this._isPlayingLoop || !Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.loopFxType);
        this._isPlayingLoop = true;
    }

    protected stopLoop(): void {
        if (!this._isPlayingLoop) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.loopFxType);
        this._isPlayingLoop = false;
    }

    public SpawnBreakHeart(): void {
        if (!this._actedInDrag && !this._completed) super.SpawnBreakHeart();
    }

    public OnDragFailReturnComplete(): void {
        if (!this._actedInDrag && !this._completed) super.OnDragFailReturnComplete();
    }
}
