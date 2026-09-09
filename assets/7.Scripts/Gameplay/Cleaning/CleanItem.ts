import { _decorator, Node, ParticleSystem2D, Vec3, Enum } from 'cc';
import { DirtCleaner } from './DirtCleaner';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';

const { ccclass, property } = _decorator;

@ccclass('CleanItem')
export class CleanItem extends Item {
    @property({ type: Node, tooltip: 'Node vị trí đầu lông chổi tiếp xúc với mạng nhện' })
    public brushPoint: Node = null!;

    @property({ type: DirtCleaner, tooltip: 'Tham chiếu tới DirtCleaner' })
    public dirtCleaner: DirtCleaner = null!;

    @property({ type: ItemDraggable, tooltip: 'Tham chiếu tới ItemDraggable trên Broom (nếu để trống sẽ tự lấy trên node)' })
    public itemDraggable: ItemDraggable | null = null;

    @property({ tooltip: 'Bật phát âm thanh loop khi đang quét' })
    public playSweepSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Chọn loại âm thanh quét từ Ply_SoundManager' })
    public sweepFxType: FxType = FxType.Clean1;

    @property({ type: ParticleSystem2D, tooltip: 'Particle trail at the brush tip. It plays only while sweeping valid dirt.' })
    public trailParticle: ParticleSystem2D | null = null;

    private _isDragging: boolean = false;
    private _isPlayingSound: boolean = false;
    private _lastBrushWorldPos: Vec3 = new Vec3();
    private _tempWorldPos: Vec3 = new Vec3();
    private _wasInvalidInsideArea: boolean = false;
    private _completedDuringCurrentDrag: boolean = false;
    private _isTrailPlaying: boolean = false;

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDragEnd = () => this.onDragEnd();

    onLoad() {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (this.dirtCleaner?.node && this.itemMoveToTarget) {
            this.itemMoveToTarget.defaultTarget = this.dirtCleaner.node;
        }
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

    public onDragStart() {
        this._isDragging = true;
        this._wasInvalidInsideArea = false;
        this._completedDuringCurrentDrag = false;

        const targetPoint = this.brushPoint ? this.brushPoint : this.node;
        targetPoint.getWorldPosition(this._lastBrushWorldPos);

        if (this.dirtCleaner && this.dirtCleaner.canClean && !this.dirtCleaner.IsCompleted) {
            const wasCompletedBeforeClean = this.dirtCleaner.IsCompleted;
            this.dirtCleaner.cleanAt(this._lastBrushWorldPos);
            if (!wasCompletedBeforeClean && this.dirtCleaner.IsCompleted) {
                this._completedDuringCurrentDrag = true;
            }
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
        this._completedDuringCurrentDrag = false;
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

        if (this.dirtCleaner && this.dirtCleaner.canClean && !this.dirtCleaner.IsCompleted) {
            const wasCompletedBeforeSweep = this.dirtCleaner.IsCompleted;
            this.dirtCleaner.sweepBetween(this._lastBrushWorldPos, this._tempWorldPos);
            if (!wasCompletedBeforeSweep && this.dirtCleaner.IsCompleted) {
                this._completedDuringCurrentDrag = true;
            }
            this.startSweepSound();
            this.startTrailParticle();
        } else {
            this.stopSweepSound();
            this.startTrailParticle();
            this.trySpawnInvalidCleanBreakHeart(this._tempWorldPos);
        }

        this._lastBrushWorldPos.set(this._tempWorldPos);
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
        if (!this.dirtCleaner) return;

        const isInvalidCompletedState = this.dirtCleaner.IsCompleted && !this._completedDuringCurrentDrag;
        const isInvalidState = isInvalidCompletedState || !this.dirtCleaner.canClean;
        if (!isInvalidState) {
            this._wasInvalidInsideArea = false;
            return;
        }

        const isInsideArea = this.dirtCleaner.IsPointInsideCleanArea(brushWorldPos, this.dirtCleaner.brushRadius);

        // Chỉ spawn 1 lần khi chổi vừa đi vào vùng quét ở trạng thái sai điều kiện.
        if (isInsideArea && !this._wasInvalidInsideArea) {
            this.SpawnBreakHeart();
            this._wasInvalidInsideArea = true;
            return;
        }

        // Rời vùng quét rồi vào lại thì cho phép spawn lại.
        if (!isInsideArea) {
            this._wasInvalidInsideArea = false;
        }
    }
}
