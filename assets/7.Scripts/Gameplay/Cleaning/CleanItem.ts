import { _decorator, Node, ParticleSystem2D, Vec3, Enum } from 'cc';
import { DirtCleaner } from './DirtCleaner';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';

const { ccclass, property } = _decorator;

@ccclass('CleanItem')
export class CleanItem extends Item {
    @property({ type: Node, tooltip: 'Node vị trí đầu lông chổi tiếp xúc với mạng nhện' })
    public brushPoint: Node = null!;

    @property({ type: DirtCleaner, tooltip: 'DirtCleaner chính (tương thích scene cũ, được gộp chung vào danh sách dirtCleaners)' })
    public dirtCleaner: DirtCleaner = null!;

    @property({ type: [DirtCleaner], tooltip: 'Danh sách các vết bẩn mà item này lau được. Một lần drag sẽ lau tất cả vết bẩn còn hợp lệ.' })
    public dirtCleaners: DirtCleaner[] = [];

    @property({ type: ItemDraggable, tooltip: 'Tham chiếu tới ItemDraggable trên Broom (nếu để trống sẽ tự lấy trên node)' })
    public itemDraggable: ItemDraggable | null = null;

    @property({ tooltip: 'Bật phát âm thanh loop khi đang quét' })
    public playSweepSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Chọn loại âm thanh quét từ Ply_SoundManager' })
    public sweepFxType: FxType = FxType.Clean1;

    @property({ type: ParticleSystem2D, tooltip: 'Particle trail at the brush tip. It plays only while sweeping valid dirt.' })
    public trailParticle: ParticleSystem2D | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi một lần khi tất cả DirtCleaner trong danh sách đã lau xong' })
    public onAllDirtCleaned: Ply_Event = new Ply_Event();

    @property({ tooltip: 'Tự gọi ItemCleanManager.ItemCleanDone() khi tất cả vết bẩn đã lau xong' })
    public callItemCleanDoneOnAllCleaned: boolean = true;

    private _cleaners: DirtCleaner[] = [];
    private _isDragging: boolean = false;
    private _isPlayingSound: boolean = false;
    private _lastBrushWorldPos: Vec3 = new Vec3();
    private _tempWorldPos: Vec3 = new Vec3();
    private _wasInvalidInsideArea: boolean = false;
    private _completedDuringCurrentDrag: Set<DirtCleaner> = new Set();
    private _isTrailPlaying: boolean = false;
    private _allCleanedFired: boolean = false;

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDragEnd = () => this.onDragEnd();

    /** Tất cả DirtCleaner hợp lệ mà item này quản lý (dirtCleaner + dirtCleaners, đã loại trùng). */
    public get Cleaners(): readonly DirtCleaner[] {
        return this._cleaners;
    }

    /** Đã lau sạch toàn bộ vết bẩn chưa. */
    public get IsAllCleaned(): boolean {
        return this._cleaners.length > 0 && this._cleaners.every(c => c.IsCompleted);
    }

    onLoad() {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.collectCleaners();
        this.updateDefaultTarget();
        if (!this.itemDraggable) {
            this.itemDraggable = this.getComponent(ItemDraggable);
        }
        this.trailParticle ??= this.brushPoint?.getComponentInChildren(ParticleSystem2D) ?? null;
        this.stopTrailParticle();

    }

    onEnable() {
        if (!this.itemDraggable) {
            this.itemDraggable = this.getComponent(ItemDraggable);
        }

        if (this.itemDraggable) {
            this.itemDraggable.onBeginDrag.addListener(this._boundOnDragStart);
            this.itemDraggable.onDropSuccess.addListener(this._boundOnDragEnd);
            this.itemDraggable.onDropFail.addListener(this._boundOnDragEnd);
            this.itemDraggable.onReturnToStartComplete.addListener(this._boundOnDragEnd);
        }
    }

    onDisable() {
        if (this.itemDraggable) {
            this.itemDraggable.onBeginDrag.removeListener(this._boundOnDragStart);
            this.itemDraggable.onDropSuccess.removeListener(this._boundOnDragEnd);
            this.itemDraggable.onDropFail.removeListener(this._boundOnDragEnd);
            this.itemDraggable.onReturnToStartComplete.removeListener(this._boundOnDragEnd);
        }

        this._isDragging = false;
        this.stopSweepSound();
        this.stopTrailParticle();
    }

    public resetInEditor() {
        super.resetInEditor();
        if (!this.onAllDirtCleaned) this.onAllDirtCleaned = new Ply_Event();
    }

    /** Gộp dirtCleaner (cũ) + dirtCleaners thành một danh sách không trùng. */
    private collectCleaners(): void {
        const seen = new Set<DirtCleaner>();
        this._cleaners = [];
        const push = (c: DirtCleaner | null | undefined) => {
            if (!c || !c.isValid || seen.has(c)) return;
            seen.add(c);
            this._cleaners.push(c);
        };
        push(this.dirtCleaner);
        for (const c of this.dirtCleaners) push(c);
        this._allCleanedFired = false;
    }

    /** Thêm một vết bẩn lúc runtime. */
    public AddDirtCleaner(cleaner: DirtCleaner): void {
        if (!cleaner || !cleaner.isValid || this._cleaners.includes(cleaner)) return;
        this._cleaners.push(cleaner);
        this._allCleanedFired = false;
        this.updateDefaultTarget();
    }

    private isCleanerActive(cleaner: DirtCleaner): boolean {
        return cleaner.isValid && cleaner.canClean && !cleaner.IsCompleted;
    }

    private hasActiveCleaner(): boolean {
        return this._cleaners.some(c => this.isCleanerActive(c));
    }

    /**
     * Hand tut hỏi lại hàm này mỗi vòng lặp nên nó luôn trỏ đúng vết bẩn còn lại, kể cả khi
     * vết bẩn hoàn thành ngay giữa lúc hint đang chạy. Khác với itemMoveToTarget.defaultTarget
     * vốn chỉ được cập nhật sau mỗi lượt quét.
     */
    public GetHandTutTarget(): Node | null {
        const next = this._cleaners.find(c => this.isCleanerActive(c));
        return next?.node ?? null;
    }

    /** Hand tut / auto move sẽ nhắm tới vết bẩn đầu tiên chưa lau xong. */
    private updateDefaultTarget(): void {
        if (!this.itemMoveToTarget) return;
        const next = this._cleaners.find(c => this.isCleanerActive(c)) ?? this._cleaners[0];
        if (next?.node) {
            this.itemMoveToTarget.defaultTarget = next.node;
        }
    }

    public onDragStart() {
        this._isDragging = true;
        this._wasInvalidInsideArea = false;
        this._completedDuringCurrentDrag.clear();

        const targetPoint = this.brushPoint ? this.brushPoint : this.node;
        targetPoint.getWorldPosition(this._lastBrushWorldPos);

        if (this.hasActiveCleaner()) {
            for (const cleaner of this._cleaners) {
                if (!this.isCleanerActive(cleaner)) continue;
                cleaner.BeginStroke();
                cleaner.cleanAt(this._lastBrushWorldPos);
                if (cleaner.IsCompleted) {
                    this._completedDuringCurrentDrag.add(cleaner);
                }
            }
            this.afterSweep();
            this.startSweepSound();
            this.startTrailParticle();
        } else {
            this.trySpawnInvalidCleanBreakHeart(this._lastBrushWorldPos);
            this.startTrailParticle();
        }
    }

    public onDragEnd() {
        this._isDragging = false;
        this._wasInvalidInsideArea = false;
        this._completedDuringCurrentDrag.clear();
        this.stopSweepSound();
        this.stopTrailParticle();
    }

    protected lateUpdate(_dt: number) {
        if (!this._isDragging) return;

        // Auto-sync if ItemDraggable is no longer in dragging session
        if (this.itemDraggable && !this.itemDraggable.IsDragging) {
            this.onDragEnd();
            return;
        }

        const targetPoint = this.brushPoint ? this.brushPoint : this.node;
        targetPoint.getWorldPosition(this._tempWorldPos);

        if (Vec3.equals(this._tempWorldPos, this._lastBrushWorldPos)) {
            return;
        }

        if (this.hasActiveCleaner()) {
            for (const cleaner of this._cleaners) {
                if (!this.isCleanerActive(cleaner)) continue;
                cleaner.sweepBetween(this._lastBrushWorldPos, this._tempWorldPos);
                if (cleaner.IsCompleted) {
                    this._completedDuringCurrentDrag.add(cleaner);
                }
            }
            this.afterSweep();
            this.startSweepSound();
            this.startTrailParticle();
            // Vẫn báo lỗi nếu chổi cọ lên vết bẩn đã sạch/bị khoá mà không chạm vết bẩn nào hợp lệ.
            this.trySpawnInvalidCleanBreakHeart(this._tempWorldPos);
        } else {
            this.stopSweepSound();
            this.startTrailParticle();
            this.trySpawnInvalidCleanBreakHeart(this._tempWorldPos);
        }

        this._lastBrushWorldPos.set(this._tempWorldPos);
    }

    /** Sau mỗi lượt quét: cập nhật target kế tiếp và bắn onAllDirtCleaned khi đã sạch hết. */
    private afterSweep(): void {
        if (this._completedDuringCurrentDrag.size > 0) {
            this.updateDefaultTarget();
        }
        if (!this._allCleanedFired && this.IsAllCleaned) {
            this._allCleanedFired = true;
            this.onAllDirtCleaned?.invoke();
            if (this.callItemCleanDoneOnAllCleaned) {
                ItemCleanManager.Ins?.ItemCleanDone(this);
            }
        }
    }

    public startSweepSound() {
        if (!this.playSweepSound || this._isPlayingSound) return;

        if (Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.PlayFxLoop(this.sweepFxType);
            this._isPlayingSound = true;
        }
    }

    public stopSweepSound() {
        if (!this._isPlayingSound) return;

        if (Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.StopFxLoop(this.sweepFxType);
        }
        this._isPlayingSound = false;
    }

    private startTrailParticle(): void {
        if (!this.trailParticle) return;
        // A trail must emit continuously for the full drag session, even if
        // its ParticleSystem2D was authored as a one-shot effect.
        this.trailParticle.node.active = true;
        this.trailParticle.enabled = true;
        this.trailParticle.duration = -1;
        this.trailParticle.autoRemoveOnFinish = false;
        this.BringTrailToFront();
        if (this._isTrailPlaying) return;
        this.trailParticle.resetSystem();
        this._isTrailPlaying = true;
    }

    private stopTrailParticle(): void {
        if (!this.trailParticle) return;
        this.trailParticle.stopSystem();
        this._isTrailPlaying = false;
    }

    private BringTrailToFront(): void {
        // BrushPoint is often placed before the broom model in the hierarchy,
        // which causes its particle to be drawn underneath the opaque sprite.
        const trailRoot = this.brushPoint?.parent === this.node ? this.brushPoint : this.trailParticle?.node;
        const parent = trailRoot?.parent;
        if (trailRoot && parent && trailRoot.getSiblingIndex() !== parent.children.length - 1) {
            trailRoot.setSiblingIndex(parent.children.length - 1);
        }
    }


    private trySpawnInvalidCleanBreakHeart(brushWorldPos: Vec3): void {
        if (this._cleaners.length === 0) return;

        // Vết bẩn "sai điều kiện": đã sạch từ trước lần drag này, hoặc đang bị khoá.
        let insideInvalidArea = false;
        for (const cleaner of this._cleaners) {
            if (!cleaner.isValid) continue;
            const isInsideArea = cleaner.IsPointInsideCleanArea(brushWorldPos, cleaner.brushRadius);
            if (!isInsideArea) continue;

            // Chạm vào vết bẩn hợp lệ thì không tính lỗi, dù có đè lên vết bẩn khác.
            if (this.isCleanerActive(cleaner) || this._completedDuringCurrentDrag.has(cleaner)) {
                this._wasInvalidInsideArea = false;
                return;
            }
            insideInvalidArea = true;
        }

        // Chỉ spawn 1 lần khi chổi vừa đi vào vùng quét ở trạng thái sai điều kiện.
        if (insideInvalidArea && !this._wasInvalidInsideArea) {
            this.SpawnBreakHeart();
            this._wasInvalidInsideArea = true;
            return;
        }

        // Rời vùng quét rồi vào lại thì cho phép spawn lại.
        if (!insideInvalidArea) {
            this._wasInvalidInsideArea = false;
        }
    }
}
