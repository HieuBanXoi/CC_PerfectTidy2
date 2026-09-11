import { _decorator, Component, Node, ParticleSystem2D, Sprite, UIOpacity, UITransform, Vec3, Enum, animation, clamp01 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';

const { ccclass, property } = _decorator;

/** Opacity ban đầu của một node được giữ riêng cho từng lượt Shower. */
interface FadeOpacityState {
    opacity: UIOpacity;
    initialOpacity: number;
}

/**
 * Shower - Vòi sen tắm / làm sạch.
 * Khi drag: kiểm tra brushPoint tiếp xúc với target.
 * Nếu tiếp xúc:
 * - Play 2 particle water.
 * - Step 1 và Step 2 có target, danh sách fade và thời gian riêng.
 * - Mỗi step gọi ItemCleanDone riêng; cùng component có thể xuất hiện 2 lần trong ItemCleanManager.items.
 */
@ccclass('Shower')
export class Shower extends Item {

    @property({ type: Node, tooltip: 'Vị trí đầu phun nước của vòi sen (nếu để trống sẽ lấy chính node Shower)' })
    public brushPoint: Node = null!;

    @property({ type: Node, tooltip: 'Node vùng mục tiêu được xịt nước (ví dụ: bọt xà phòng, vết bẩn, đối tượng)' })
    public cleanTarget: Node = null!;

    @property({ tooltip: 'Bán kính xịt nước tại brushPoint (world units/pixels)' })
    public cleanRadius: number = 40;

    @property({ type: ParticleSystem2D, tooltip: 'Particle nước thứ 1' })
    public waterParticle1: ParticleSystem2D | null = null;

    @property({ type: ParticleSystem2D, tooltip: 'Particle nước thứ 2' })
    public waterParticle2: ParticleSystem2D | null = null;

    @property({ type: Node, tooltip: 'Node wet particle được bật đúng một lần khi Shower lần đầu chạm clean target.' })
    public wetParticleNode: Node | null = null;

    @property({ type: [Node], tooltip: 'Danh sách các node/sprite sẽ MỜ DẦN (ví dụ: bọt xà phòng, vết bẩn biến mất)' })
    public fadeOutSprites: Node[] = [];

    @property({ type: [Node], tooltip: 'Danh sách các node/sprite sẽ ĐẬM DẦN (ví dụ: bề mặt sạch bóng hiện rõ lên)' })
    public fadeInSprites: Node[] = [];

    @property({ min: 0.1, tooltip: 'Thời gian fade của lượt tắm này (giây). Chỉ tính khi đang giữ drag và brushPoint ở trong cleanTarget.' })
    public requiredCleanTime: number = 2.0;

    @property({ tooltip: 'Bật step tắm thứ 2. Tắt để giữ hành vi Shower cũ chỉ có một step.' })
    public useSecondCleanStep: boolean = false;

    @property({ type: Node, tooltip: 'Vùng clean của step 2. Để trống sẽ dùng cleanTarget của step 1.' })
    public cleanTargetStep2: Node = null!;

    @property({ type: [Node], tooltip: 'Các node/sprite fade OUT riêng của step 2.' })
    public fadeOutSpritesStep2: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node/sprite fade IN riêng của step 2.' })
    public fadeInSpritesStep2: Node[] = [];

    @property({ min: 0.1, tooltip: 'Thời gian fade của step 2 (giây). Chỉ tính khi đang giữ drag và brushPoint ở target step 2 (hoặc cleanTarget step 1 nếu target step 2 để trống).' })
    public requiredCleanTimeStep2: number = 2.0;

    @property({ min: 1, max: 100, step: 1, tooltip: 'Phần trăm thời gian step 2 mà các soap particle phải dừng hết.' })
    public step2SoapStopEndPercent: number = 70;

    @property({ type: [ParticleSystem2D], tooltip: 'Particle soap của step 2. Chúng sẽ stop lần lượt, phân đều trong Required Clean Time Step 2.' })
    public soapParticlesToStopStep2: ParticleSystem2D[] = [];

    @property({ type: animation.AnimationController, tooltip: 'Animation Controller nhận trigger IN khi brush vào target và OUT khi brush ra ngoài.' })
    public cleanTargetAnimationController: animation.AnimationController | null = null;

    @property({ tooltip: 'Bật phát âm thanh loop khi đang xịt nước' })
    public playWaterSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Âm thanh xịt nước loop' })
    public waterFxType: FxType = FxType.Clean1;

    @property({ type: ItemCleanManager, tooltip: 'ItemCleanManager quản lý tiến trình (sẽ tự động gọi ItemCleanDone khi hoàn thành)' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Sự kiện khi hoàn thành việc xịt sạch' })
    public onShowerComplete: Ply_Event = new Ply_Event();

    @property({ min: 1, max: 100, step: 1, tooltip: 'Phần trăm thời gian step 2 để bắn On Step2 Progress Reached (mặc định 50%).' })
    public step2ProgressEventPercent: number = 50;

    @property({ type: Ply_Event, tooltip: 'Sự kiện bắn đúng một lần khi step 2 đạt Step2 Progress Event Percent thời gian.' })
    public onStep2ProgressReached: Ply_Event = new Ply_Event();

    private _isDragging: boolean = false;
    private _isWaterPlaying: boolean = false;
    private _isPlayingSound: boolean = false;
    private _hasCleanedInCurrentDrag: boolean = false;
    private _cleanedTime: number = 0;
    private _currentCleanStep: number = 0;
    private _isCompleted: boolean = false;
    private _stoppedSoapParticlesStep2: number = 0;
    private _hasFiredStep2ProgressEvent: boolean = false;
    private _isBrushInsideCleanTarget: boolean = false;
    private _hasActivatedWetParticle: boolean = false;

    private _fadeOutOpacityStates: FadeOpacityState[][] = [[], []];
    private _fadeInOpacityStates: FadeOpacityState[][] = [[], []];

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

        if (this.getCleanTarget(0) && this.itemMoveToTarget) {
            this.itemMoveToTarget.defaultTarget = this.getCleanTarget(0);
        }

        this.initOpacities();
        this.stopWaterParticles();
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
        this.stopWaterParticles();
        this.stopWaterSound();
    }

    /**
     * Lưu opacity đang được cấu hình trên từng node.
     * Không ép opacity về 255, để Sprite có alpha màu riêng vẫn hiện đúng ở cuối fade.
     */
    private initOpacities(): void {
        this._fadeOutOpacityStates[0] = this.createOpacityStates(this.fadeOutSprites, false);
        this._fadeInOpacityStates[0] = this.createOpacityStates(this.fadeInSprites, true);
        this._fadeOutOpacityStates[1] = this.createOpacityStates(this.fadeOutSpritesStep2, false);
        this._fadeInOpacityStates[1] = this.createOpacityStates(this.fadeInSpritesStep2, true);
    }

    private createOpacityStates(nodes: Node[], startHidden: boolean): FadeOpacityState[] {
        const states: FadeOpacityState[] = [];
        for (const node of nodes) {
            if (node && node.isValid) {
                let op = node.getComponent(UIOpacity);
                if (!op) op = node.addComponent(UIOpacity);
                states.push({ opacity: op, initialOpacity: op.opacity });
                if (startHidden) {
                    op.opacity = 0;
                }
            }
        }
        return states;
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem()) {
            return;
        }

        // Sau khi step 1 báo xong, manager sẽ kích hoạt chính Shower này ở entry kế tiếp.
        // Chỉ lúc đó mới mở khóa để drag lần hai, với step 2 đang chờ sẵn.
        if (this._isCompleted && this._currentCleanStep === 1) {
            this._isCompleted = false;
            this.isDone = false;
        }

        if (this._isCompleted) {
            return;
        }
        this._isDragging = true;
        this._hasCleanedInCurrentDrag = false;
    }

    public onDragEnd(): void {
        this._isDragging = false;
        this.updateCleanTargetAnimationState(false);
        this.stopWaterParticles();
        this.stopWaterSound();
    }

    public onDropFail(): void {
        this.onDragEnd();
        // Nếu trong lượt kéo vừa rồi đã xịt trúng target thì triệt tiêu BreakHeart
        if (this._hasCleanedInCurrentDrag && this.itemDraggable) {
            this.itemDraggable.ConsumeCurrentDropFail();
            if (this.itemDraggable.returnToStartOnDragFailed) {
                this.itemDraggable.ReturnToStartWithoutHeart();
            }
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this._isDragging || this._isCompleted) return;

        if (this.itemDraggable && !this.itemDraggable.IsDragging) {
            this.onDragEnd();
            return;
        }

        const isTouching = this.checkTouchingTarget(this.getCleanTarget(this._currentCleanStep));
        this.updateCleanTargetAnimationState(isTouching);

        if (isTouching) {
            this._hasCleanedInCurrentDrag = true;
            this.activateWetParticleOnce();
            this.startWaterParticles();
            this.startWaterSound();

            // Tăng thời gian xịt nước
            this._cleanedTime += dt;
            const progress = clamp01(this._cleanedTime / this.getStepCleanTime(this._currentCleanStep));

            // Cập nhật độ mờ của 2 list sprite
            this.updateSpritesAlpha(this._currentCleanStep, progress);
            if (this._currentCleanStep === 1) {
                this.updateStep2SoapParticles(progress);
                this.fireStep2ProgressEventOnce(progress);
            }

            // Kiểm tra hoàn thành
            if (progress >= 1.0 && !this._isCompleted) {
                this.completeCurrentStep();
            }
        } else {
            this.stopWaterParticles();
            this.stopWaterSound();
        }
    }

    /** Kiểm tra xem brushPoint có chạm vào cleanTarget hay không */
    private getCleanTarget(step: number): Node | null {
        return step === 1 ? (this.cleanTargetStep2 || this.cleanTarget) : this.cleanTarget;
    }

    /** Returns the target for the currently active shower step. */
    public GetHandTutTarget(): Node | null {
        return this.getCleanTarget(this._currentCleanStep);
    }

    private getStepCleanTime(step: number): number {
        return Math.max(0.1, step === 1 ? this.requiredCleanTimeStep2 : this.requiredCleanTime);
    }

    /** Kiểm tra brushPoint có chạm vào target của step đang chạy không. */
    private checkTouchingTarget(target: Node | null): boolean {
        if (!target || !target.isValid || !target.activeInHierarchy) {
            return false;
        }

        const brush = this.brushPoint ? this.brushPoint : this.node;
        brush.getWorldPosition(this._tempWorldPos);

        const targetTransform = target.getComponent(UITransform);
        if (targetTransform) {
            // Kiểm tra theo bounding box UITransform có cộng thêm cleanRadius
            const localPos = targetTransform.convertToNodeSpaceAR(this._tempWorldPos);
            const left = -targetTransform.anchorX * targetTransform.width - this.cleanRadius;
            const right = (1 - targetTransform.anchorX) * targetTransform.width + this.cleanRadius;
            const bottom = -targetTransform.anchorY * targetTransform.height - this.cleanRadius;
            const top = (1 - targetTransform.anchorY) * targetTransform.height + this.cleanRadius;

            return localPos.x >= left && localPos.x <= right && localPos.y >= bottom && localPos.y <= top;
        } else {
            // Fallback so sánh khoảng cách worldPosition
            target.getWorldPosition(this._tempTargetPos);
            const dist = Vec3.distance(this._tempWorldPos, this._tempTargetPos);
            return dist <= this.cleanRadius;
        }
    }

    /** Fade-in chạy toàn bộ thời gian; fade-out chỉ bắt đầu khi fade-in đã đạt 50%. */
    private updateSpritesAlpha(step: number, progress: number): void {
        const fadeOutProgress = clamp01((progress - 0.5) / 0.5);
        for (const state of this._fadeOutOpacityStates[step]) {
            const op = state.opacity;
            if (op && op.isValid) {
                op.opacity = Math.round((1 - fadeOutProgress) * state.initialOpacity);
                if (fadeOutProgress >= 1.0) {
                    op.node.active = false;
                }
            }
        }

        for (const state of this._fadeInOpacityStates[step]) {
            const op = state.opacity;
            if (op && op.isValid) {
                op.opacity = Math.round(progress * state.initialOpacity);
                if (progress > 0 && !op.node.active) {
                    op.node.active = true;
                }
            }
        }
    }

    /** Stop các particle soap step 2 theo từng mốc thời gian được chia đều. */
    private updateStep2SoapParticles(progress: number): void {
        const stopEndProgress = clamp01(
            (Number.isFinite(this.step2SoapStopEndPercent) ? this.step2SoapStopEndPercent : 70) / 100,
        );
        const normalizedProgress = stopEndProgress >= 1
            ? progress
            : clamp01(progress / Math.max(0.01, stopEndProgress));
        const stopCount = Math.min(
            this.soapParticlesToStopStep2.length,
            progress >= stopEndProgress
                ? this.soapParticlesToStopStep2.length
                : Math.floor(normalizedProgress * this.soapParticlesToStopStep2.length),
        );

        while (this._stoppedSoapParticlesStep2 < stopCount) {
            const particle = this.soapParticlesToStopStep2[this._stoppedSoapParticlesStep2++];
            if (particle && particle.isValid) {
                particle.stopSystem();
            }
        }
    }

    /** Bắn onStep2ProgressReached đúng một lần khi step 2 chạm mốc phần trăm cấu hình. */
    private fireStep2ProgressEventOnce(progress: number): void {
        if (this._hasFiredStep2ProgressEvent) return;

        const threshold = clamp01(
            (Number.isFinite(this.step2ProgressEventPercent) ? this.step2ProgressEventPercent : 50) / 100,
        );
        if (progress < threshold) return;

        this._hasFiredStep2ProgressEvent = true;
        this.onStep2ProgressReached.invoke();
    }

    /** Bắn trigger đúng một lần mỗi khi brush đổi trạng thái vào/ra vùng clean. */
    private updateCleanTargetAnimationState(isInside: boolean): void {
        if (this._isBrushInsideCleanTarget === isInside) return;

        this._isBrushInsideCleanTarget = isInside;
        this.cleanTargetAnimationController?.setValue(isInside ? 'In' : 'Out', true);
    }

    private activateWetParticleOnce(): void {
        if (this._hasActivatedWetParticle) return;

        this._hasActivatedWetParticle = true;
        if (this.wetParticleNode && this.wetParticleNode.isValid) {
            this.wetParticleNode.active = true;
        }
    }

    private completeCurrentStep(): void {
        if (this._currentCleanStep === 0 && this.useSecondCleanStep) {
            this._currentCleanStep = 1;
            this._cleanedTime = 0;
            this._stoppedSoapParticlesStep2 = 0;
            this._hasFiredStep2ProgressEvent = false;
            this._isCompleted = true;
            this.isDone = true;
            this.stopWaterParticles();
            this.stopWaterSound();
            (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
            return;
        }
        this.completeShower();
    }

    /** Chỉ cho clean khi Shower là entry hiện tại của ItemCleanManager. */
    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) {
            return true;
        }
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    private completeShower(): void {
        this._isCompleted = true;
        this.isDone = true;
        this.stopWaterParticles();
        this.stopWaterSound();

        this.onShowerComplete.invoke();

        // Tự động kết nối với ItemCleanManager
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
    }

    private startWaterParticles(): void {
        if (!this._isWaterPlaying) {
            this._isWaterPlaying = true;
            if (this.waterParticle1) {
                this.waterParticle1.node.active = true;
                this.waterParticle1.resetSystem();
            }
            if (this.waterParticle2) {
                this.waterParticle2.node.active = true;
                this.waterParticle2.resetSystem();
            }
        }
    }

    private stopWaterParticles(): void {
        if (this._isWaterPlaying) {
            this._isWaterPlaying = false;
            if (this.waterParticle1) this.waterParticle1.stopSystem();
            if (this.waterParticle2) this.waterParticle2.stopSystem();
        }
    }

    private startWaterSound(): void {
        if (!this.playWaterSound || this._isPlayingSound) return;
        if (Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.PlayFxLoop(this.waterFxType);
            this._isPlayingSound = true;
        }
    }

    private stopWaterSound(): void {
        if (!this._isPlayingSound) return;
        if (Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.StopFxLoop(this.waterFxType);
        }
        this._isPlayingSound = false;
    }

    /** Ghi đè: chỉ spawn BreakHeart nếu không xịt trúng target trong lượt kéo này */
    public OnDragFailReturnComplete(): void {
        if (!this._hasCleanedInCurrentDrag) {
            super.OnDragFailReturnComplete();
        }
    }

    public SpawnBreakHeart(): void {
        if (!this._hasCleanedInCurrentDrag) {
            super.SpawnBreakHeart();
        }
    }
}
