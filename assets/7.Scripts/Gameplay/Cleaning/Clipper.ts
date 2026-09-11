import { _decorator, Node, Sprite, Tween, tween, Vec3, UIOpacity, UITransform, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { World } from '../../Core/Managers/World';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { HairEffect } from '../Effects/HairEffect';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { CleaningSoundMode } from './CleaningSoundMode';

const { ccclass, property } = _decorator;

/** Internal state tracking per hair target */
class HairTargetState {
    public node: Node;
    public hitCount: number = 0;
    public isCut: boolean = false;
    public wasInsideInLastFrame: boolean = false;

    constructor(node: Node) {
        this.node = node;
    }
}

@ccclass('Clipper')
export class Clipper extends Item {

    @property({ type: Node, tooltip: 'Vị trí đầu kéo/lưỡi cắt (nếu để trống sẽ lấy chính node Clipper)' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính quét/cắt tại brushPoint (world units/pixels)' })
    public cutRadius: number = 30;

    @property({ type: [Node], tooltip: 'Danh sách các node sợi lông (target)' })
    public hairTargets: Node[] = [];

    @property({ tooltip: 'Số lần kéo qua để cắt đứt 1 sợi lông' })
    public hitsToCut: number = 3;

    @property({ tooltip: 'Thời gian lông rơi xuống trước khi biến mất (giây)' })
    public fallDuration: number = 0.6;

    @property({ tooltip: 'Khoảng cách lông rơi xuống theo trục Y' })
    public fallDistanceY: number = 100;

    @property({ tooltip: 'Phát âm thanh mỗi khi cắt trúng lông' })
    public playCutSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Loại âm thanh khi cắt trúng' })
    public cutFxType: FxType = FxType.Clean2;

    @property({ tooltip: 'Loop sound while dragging the clipper.' })
    public playDragSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Loop sound type while dragging.' })
    public dragFxType: FxType = FxType.Clean1;

    @property({ type: Enum(CleaningSoundMode), tooltip: 'When the drag loop sound is audible.' })
    public dragSoundMode: CleaningSoundMode = CleaningSoundMode.Always;

    @property({ type: ItemCleanManager, tooltip: 'Manager quản lý thứ tự các item làm sạch (sẽ tự động gọi ItemCleanDone khi cắt sạch lông)' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Sự kiện khi 1 sợi lông bị cắt đứt rơi xuống' })
    public onHairCut: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Sự kiện khi toàn bộ lông đã bị cắt sạch' })
    public onAllHairsCleared: Ply_Event = new Ply_Event();

    private _targetStates: HairTargetState[] = [];
    private _isDragging: boolean = false;
    private _hasCutInCurrentDrag: boolean = false;
    private _isPlayingDragSound: boolean = false;
    private _tempWorldPos: Vec3 = new Vec3();
    private _tempTargetPos: Vec3 = new Vec3();

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDragEnd = () => this.onDragEnd();
    private _boundOnDropFail = () => this.onDropFail();

    onLoad() {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (!this.itemDraggable) {
            this.itemDraggable = this.getComponent(ItemDraggable);
        }
        this.initHairStates();
    }

    onEnable() {
        if (!this.itemDraggable) {
            this.itemDraggable = this.getComponent(ItemDraggable);
        }

        if (this.itemDraggable) {
            this.itemDraggable.onBeginDrag.addListener(this._boundOnDragStart);
            this.itemDraggable.onDropSuccess.addListener(this._boundOnDragEnd);
            this.itemDraggable.onDropFail.addListener(this._boundOnDropFail);
            this.itemDraggable.onReturnToStartComplete.addListener(this._boundOnDragEnd);
        }
    }

    onDisable() {
        if (this.itemDraggable) {
            this.itemDraggable.onBeginDrag.removeListener(this._boundOnDragStart);
            this.itemDraggable.onDropSuccess.removeListener(this._boundOnDragEnd);
            this.itemDraggable.onDropFail.removeListener(this._boundOnDropFail);
            this.itemDraggable.onReturnToStartComplete.removeListener(this._boundOnDragEnd);
        }
        this._isDragging = false;
        this.stopDragSound();
    }

    /**
     * Khởi tạo hoặc cập nhật lại danh sách target sợi lông
     */
    public initHairStates(): void {
        this._targetStates = [];
        for (const node of this.hairTargets) {
            if (node && node.isValid) {
                this._targetStates.push(new HairTargetState(node));
            }
        }
    }

    /** Returns the next uncut hair for HandTut's drag destination. */
    public GetHandTutTarget(): Node | null {
        return this._targetStates.find(state => !state.isCut && state.node.activeInHierarchy)?.node ?? null;
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem()) {
            return;
        }
        this._isDragging = true;
        this._hasCutInCurrentDrag = false;
        this.startDragSound();
        // Reset trạng thái hover/inside của frame trước khi bắt đầu drag mới
        for (const state of this._targetStates) {
            state.wasInsideInLastFrame = false;
        }
        this.checkCutHairs();
    }

    public onDragEnd(): void {
        this._isDragging = false;
        this.stopDragSound();
        for (const state of this._targetStates) {
            state.wasInsideInLastFrame = false;
        }
    }

    public onDropFail(): void {
        this.onDragEnd();
        // Nếu trong lượt kéo này đã cắt được lông thì triệt tiêu BreakHeart của ItemDraggable
        if (this._hasCutInCurrentDrag && this.itemDraggable) {
            this.itemDraggable.ConsumeCurrentDropFail();
            if (this.itemDraggable.returnToStartOnDragFailed) {
                this.itemDraggable.ReturnToStartWithoutHeart();
            }
        }
    }

    protected lateUpdate(_dt: number): void {
        if (!this._isDragging) return;

        if (!this.isCurrentCleanManagerItem()) {
            this.onDragEnd();
            return;
        }

        if (this.itemDraggable && !this.itemDraggable.IsDragging) {
            this.onDragEnd();
            return;
        }

        this.checkCutHairs();
    }

    /** Chỉ cắt khi Clipper là item đang có onProcess trong ItemCleanManager. */
    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) {
            return true;
        }
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /**
     * Kiểm tra vị trí brushPoint so với các sợi lông
     */
    private startDragSound(isOverTarget = false): void {
        if (!this.playDragSound || (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget)
            || this._isPlayingDragSound || !Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.dragFxType);
        this._isPlayingDragSound = true;
    }

    private stopDragSound(): void {
        if (!this._isPlayingDragSound) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.dragFxType);
        this._isPlayingDragSound = false;
    }

    private checkCutHairs(): void {
        const brush = this.brushPoint ? this.brushPoint : this.node;
        brush.getWorldPosition(this._tempWorldPos);

        const radiusSq = this.cutRadius * this.cutRadius;
        let isOverAnyTarget = false;

        for (const state of this._targetStates) {
            if (state.isCut || !state.node || !state.node.isValid || !state.node.activeInHierarchy) {
                continue;
            }

            state.node.getWorldPosition(this._tempTargetPos);
            const dx = this._tempWorldPos.x - this._tempTargetPos.x;
            const dy = this._tempWorldPos.y - this._tempTargetPos.y;
            const distSq = dx * dx + dy * dy;

            const isInside = distSq <= radiusSq;
            if (isInside) isOverAnyTarget = true;

            // Nhận diện lần kéo chạm vào lông (chuyển trạng thái từ ngoài vào trong)
            if (isInside && !state.wasInsideInLastFrame) {
                this.hitHair(state, this._tempTargetPos);
            }

            state.wasInsideInLastFrame = isInside;
        }
        this.updateDragSound(isOverAnyTarget);
    }

    private updateDragSound(isOverTarget: boolean): void {
        if (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget) {
            this.stopDragSound();
            return;
        }
        this.startDragSound(isOverTarget);
    }

    /**
     * Xử lý khi cắt trúng 1 sợi lông
     */
    private hitHair(state: HairTargetState, targetWorldPos: Vec3): void {
        state.hitCount++;
        this._hasCutInCurrentDrag = true;

        // Spawn HairEffect tại vị trí sợi lông và gán node target làm cha
        const hairEffect = World.instance?.poolManager?.spawnType<HairEffect>(PoolType.HairFX, targetWorldPos);
        if (hairEffect) {
            hairEffect.node.setParent(state.node);
            hairEffect.node.setPosition(0, 0, 0);
            hairEffect.PlaySpawn(0.5, 1.0);
        }

        if (this.playCutSound && Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.PlayFx(this.cutFxType);
        }

        // Đạt số lần yêu cầu (mặc định 3 lần) -> rụng và rơi xuống mờ dần
        if (state.hitCount >= this.hitsToCut) {
            state.isCut = true;
            this.dropAndFadeHair(state.node);
            this.onHairCut.invoke();

            if (this.checkAllHairsCleared()) {
                this.isDone = true;
                this.onAllHairsCleared.invoke();
                (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
            }
        }
    }

    /**
     * Hiệu ứng rụng lông: rơi xuống (tween position) đồng thời mờ dần (UIOpacity)
     */
    private dropAndFadeHair(hairNode: Node): void {
        if (!hairNode || !hairNode.isValid) return;

        // Đảm bảo có UIOpacity để fade out
        let uiOpacity = hairNode.getComponent(UIOpacity);
        if (!uiOpacity) {
            uiOpacity = hairNode.addComponent(UIOpacity);
        }
        uiOpacity.opacity = 255;

        const currentPos = hairNode.position.clone();
        const targetPos = new Vec3(currentPos.x, currentPos.y - this.fallDistanceY, currentPos.z);

        // Tween rơi xuống
        Tween.stopAllByTarget(hairNode);
        tween(hairNode)
            .to(this.fallDuration, { position: targetPos }, { easing: 'cubicIn' })
            .call(() => {
                hairNode.active = false;
            })
            .start();

        // Tween mờ dần
        Tween.stopAllByTarget(uiOpacity);
        tween(uiOpacity)
            .to(this.fallDuration, { opacity: 0 }, { easing: 'linear' })
            .start();
    }

    /**
     * Kiểm tra xem toàn bộ các sợi lông trong danh sách đã được cắt hết chưa
     */
    public checkAllHairsCleared(): boolean {
        for (const state of this._targetStates) {
            if (!state.isCut && state.node && state.node.isValid) {
                return false;
            }
        }
        return true;
    }

    /**
     * Khi kéo thả về vị trí ban đầu (return to start):
     * Chỉ spawn BreakHeart nếu trong lượt kéo vừa rồi KHÔNG cắt trúng/đứt sợi lông nào.
     * Nếu đã cắt được lông thì không spawn BreakHeart.
     */
    public OnDragFailReturnComplete(): void {
        if (!this._hasCutInCurrentDrag) {
            super.OnDragFailReturnComplete();
        }
    }

    /**
     * Ghi đè SpawnBreakHeart: nếu đã cắt được lông trong lượt kéo này thì không cho hiện BreakHeart.
     */
    public SpawnBreakHeart(): void {
        if (!this._hasCutInCurrentDrag) {
            super.SpawnBreakHeart();
        }
    }
}
