import { _decorator, Node, ParticleSystem2D, Sprite, UITransform, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CleaningSoundMode } from './CleaningSoundMode';

const { ccclass, property } = _decorator;

/** One dirty target and the clean sprite revealed beneath it. */
@ccclass('BlowdryerTarget')
export class BlowdryerTarget {
    @property({ type: Node, tooltip: 'Target sprite bị thổi mờ dần.' })
    public targetNode: Node | null = null;

    @property({ type: Node, tooltip: 'Sprite tương ứng hiện dần khi target đã mờ từ 50% trở lên.' })
    public revealSprite: Node | null = null;
}

class BlowdryerTargetState {
    public cleanTime = 0;
    public isFaded = false;
    public wasInsideInLastFrame = false;
    public readonly targetSprite: Sprite | null;
    public readonly targetInitialOpacity: number;
    public readonly revealVisual: Sprite | null;
    public readonly revealInitialOpacity: number;
    public readonly transform: UITransform | null;

    constructor(public readonly target: Node, public readonly reveal: Node | null) {
        // Preserve the actual alpha authored on each Sprite. A UIOpacity
        // component may retain 0 from a prior run, which otherwise hides the
        // target immediately and prevents the reveal from becoming visible.
        this.targetSprite = target.getComponent(Sprite) ?? target.getComponentInChildren(Sprite);
        this.targetInitialOpacity = this.targetSprite?.color.a ?? 255;
        this.transform = target.getComponent(UITransform);

        if (reveal && reveal.isValid) {
            this.revealVisual = reveal.getComponent(Sprite) ?? reveal.getComponentInChildren(Sprite);
            this.revealInitialOpacity = this.revealVisual?.color.a ?? 255;
            if (this.revealVisual) {
                const color = this.revealVisual.color.clone();
                color.a = 0;
                this.revealVisual.color = color;
            }
        } else {
            this.revealVisual = null;
            this.revealInitialOpacity = 0;
        }
    }
}

/**
 * Blows dirty targets away over time. The clean sprite fades in for the whole
 * clean duration; the dirty sprite only fades out after that fade-in reaches
 * 50%, matching Shower's fade timing.
 */
@ccclass('Blowdryer')
export class Blowdryer extends Item {
    @property({ type: Node, tooltip: 'Đầu máy sấy dùng để kiểm tra target. Để trống sẽ dùng node Blowdryer.' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính thổi tại brushPoint (world units/pixels).' })
    public blowRadius = 30;

    @property({ type: ParticleSystem2D, tooltip: 'Particle thổi/sấy 1. Bật khi Brush Point ở trong target.' })
    public blowParticle1: ParticleSystem2D | null = null;

    @property({ type: ParticleSystem2D, tooltip: 'Particle thổi/sấy 2. Bật khi Brush Point ở trong target.' })
    public blowParticle2: ParticleSystem2D | null = null;

    @property({ type: [BlowdryerTarget], tooltip: 'Các cặp target bị thổi và sprite được hiện ra.' })
    public targets: BlowdryerTarget[] = [];

    @property({ min: 0.1, tooltip: 'Thời gian Brush Point cần ở trên mỗi target để làm mờ hết target đó (giây).' })
    public requiredFadeTime = 2;

    @property({ tooltip: 'Play a sound when a blowdryer target is cleaned.' })
    public playCutSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Sound played when a blowdryer target is cleaned.' })
    public cutFxType: FxType = FxType.Clean2;

    @property({ tooltip: 'Play a loop while dragging the blowdryer.' })
    public playDragSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Loop sound while dragging the blowdryer.' })
    public dragFxType: FxType = FxType.Clean1;

    @property({ type: Enum(CleaningSoundMode), tooltip: 'When the drag loop sound is audible.' })
    public dragSoundMode: CleaningSoundMode = CleaningSoundMode.Always;

    @property({ type: ItemCleanManager, tooltip: 'Manager điều phối lượt; Blowdryer chỉ hoạt động khi có onProcess.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi một target đã bị thổi mờ hoàn toàn.' })
    public onTargetFaded: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi mọi target đã bị thổi xong.' })
    public onAllTargetsFaded: Ply_Event = new Ply_Event();

    private targetStates: BlowdryerTargetState[] = [];
    private isDraggingBlowdryer = false;
    private isDragSoundPlaying = false;
    private isBlowParticlesPlaying = false;
    private hasHitTargetInCurrentDrag = false;
    private brushWorldPosition = new Vec3();
    private targetWorldPosition = new Vec3();
    private brushLocalPosition = new Vec3();

    private readonly boundOnDragStart = () => this.onDragStart();
    private readonly boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.initializeTargets();
        this.stopBlowParticles();
    }

    protected onEnable(): void {
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.itemDraggable?.onBeginDrag.addListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.addListener(this.boundOnDragEnd);
        this.itemDraggable?.onDropFail.addListener(this.boundOnDragEnd);
        this.itemDraggable?.onReturnToStartComplete.addListener(this.boundOnDragEnd);
    }

    protected onDisable(): void {
        this.itemDraggable?.onBeginDrag.removeListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.removeListener(this.boundOnDragEnd);
        this.itemDraggable?.onDropFail.removeListener(this.boundOnDragEnd);
        this.itemDraggable?.onReturnToStartComplete.removeListener(this.boundOnDragEnd);
        this.isDraggingBlowdryer = false;
        this.stopDragSound();
        this.stopBlowParticles();
    }

    public initializeTargets(): void {
        this.targetStates = this.targets
            .filter(pair => !!pair.targetNode && pair.targetNode.isValid)
            .map(pair => new BlowdryerTargetState(pair.targetNode!, pair.revealSprite));
    }

    /** Returns the next dirty area for HandTut's drag destination. */
    public GetHandTutTarget(): Node | null {
        return this.targetStates.find(state => !state.isFaded && state.target.activeInHierarchy)?.target ?? null;
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem() || this.isDone) return;

        this.isDraggingBlowdryer = true;
        this.startDragSound();
        this.startBlowParticles();
        this.hasHitTargetInCurrentDrag = false;
        for (const state of this.targetStates) state.wasInsideInLastFrame = false;
        this.checkTargets(0);
    }

    public onDragEnd(): void {
        this.isDraggingBlowdryer = false;
        this.stopDragSound();
        this.stopBlowParticles();
        for (const state of this.targetStates) state.wasInsideInLastFrame = false;
    }

    protected lateUpdate(dt: number): void {
        if (!this.isDraggingBlowdryer) return;
        if (!this.isCurrentCleanManagerItem() || (this.itemDraggable && !this.itemDraggable.IsDragging)) {
            this.onDragEnd();
            return;
        }
        this.checkTargets(dt);
    }

    private startDragSound(isOverTarget = false): void {
        if (!this.playDragSound || (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget)
            || this.isDragSoundPlaying || !Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.dragFxType);
        this.isDragSoundPlaying = true;
    }

    private stopDragSound(): void {
        if (!this.isDragSoundPlaying) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.dragFxType);
        this.isDragSoundPlaying = false;
    }

    private updateDragSound(isOverTarget: boolean): void {
        if (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget) {
            this.stopDragSound();
            return;
        }
        this.startDragSound(isOverTarget);
    }

    private checkTargets(dt: number): void {
        const brush = this.brushPoint || this.node;
        brush.getWorldPosition(this.brushWorldPosition);
        let isOverAnyTarget = false;
        for (const state of this.targetStates) {
            if (state.isFaded || !state.target.isValid || !state.target.activeInHierarchy) continue;

            const isInside = this.isBrushInsideTarget(state);
            if (isInside) isOverAnyTarget = true;
            if (isInside) this.updateTargetFade(state, dt);
            state.wasInsideInLastFrame = isInside;
        }
        this.updateDragSound(isOverAnyTarget);

        // The dryer effect follows the drag session, not target contact.
        // Target contact only controls cleaning progress above.
        if (this.isDraggingBlowdryer && !this.isDone) this.startBlowParticles();
    }

    /**
     * Only count clean time while the Brush Point UITransform overlaps the
     * target UITransform. This allows the brush graphic to cover a target
     * naturally instead of requiring their pivots to be nearly identical.
     */
    private isBrushInsideTarget(state: BlowdryerTargetState): boolean {
        const brush = this.brushPoint || this.node;
        const brushTransform = brush.getComponent(UITransform);
        const transform = state.transform && state.transform.isValid ? state.transform : null;
        if (brushTransform && transform) {
            const brushRect = brushTransform.getBoundingBoxToWorld();
            const targetRect = transform.getBoundingBoxToWorld();
            return brushRect.intersects(targetRect);
        }

        if (transform) {
            transform.convertToNodeSpaceAR(this.brushWorldPosition, this.brushLocalPosition);
            const left = -transform.anchorX * transform.width;
            const right = (1 - transform.anchorX) * transform.width;
            const bottom = -transform.anchorY * transform.height;
            const top = (1 - transform.anchorY) * transform.height;
            return this.brushLocalPosition.x >= left && this.brushLocalPosition.x <= right
                && this.brushLocalPosition.y >= bottom && this.brushLocalPosition.y <= top;
        }

        state.target.getWorldPosition(this.targetWorldPosition);
        const dx = this.brushWorldPosition.x - this.targetWorldPosition.x;
        const dy = this.brushWorldPosition.y - this.targetWorldPosition.y;
        return dx * dx + dy * dy <= this.blowRadius * this.blowRadius;
    }

    private updateTargetFade(state: BlowdryerTargetState, dt: number): void {
        this.hasHitTargetInCurrentDrag = true;
        state.cleanTime += dt;
        const fadeProgress = Math.min(1, state.cleanTime / Math.max(0.1, this.requiredFadeTime));
        // Fade-in runs from 0% to 100% for the full clean duration. Fade-out
        // stays intact for the first half, then completes during the latter half.
        const fadeOutProgress = Math.max(0, Math.min(1, (fadeProgress - 0.5) / 0.5));

        if (state.targetSprite && state.targetSprite.isValid) {
            const color = state.targetSprite.color.clone();
            color.a = Math.round((1 - fadeOutProgress) * state.targetInitialOpacity);
            state.targetSprite.color = color;
        }

        if (state.reveal && state.revealVisual) {
            state.reveal.active = true;
            const color = state.revealVisual.color.clone();
            color.a = Math.round(fadeProgress * state.revealInitialOpacity);
            state.revealVisual.color = color;
        }

        this.finishTargetFadeIfNeeded(state, fadeProgress);
    }

    private finishTargetFadeIfNeeded(state: BlowdryerTargetState, fadeProgress: number): void {
        if (fadeProgress < 1 || state.isFaded || !state.target.isValid) return;

            state.isFaded = true;
            state.target.active = false;
            if (this.playCutSound) Ply_SoundManager.Ins?.PlayFx(this.cutFxType);
            this.onTargetFaded.invoke();
        if (!this.targetStates.every(target => target.isFaded)) return;

        this.isDone = true;
        this.onAllTargetsFaded.invoke();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
    }

    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    private startBlowParticles(): void {
        if (this.isBlowParticlesPlaying) return;

        this.isBlowParticlesPlaying = true;
        for (const particle of [this.blowParticle1, this.blowParticle2]) {
            if (!particle || !particle.isValid) continue;
            particle.node.active = true;
            particle.resetSystem();
        }
    }

    private stopBlowParticles(): void {
        this.isBlowParticlesPlaying = false;
        this.blowParticle1?.stopSystem();
        this.blowParticle2?.stopSystem();
    }

    public OnDragFailReturnComplete(): void {
        if (!this.hasHitTargetInCurrentDrag) super.OnDragFailReturnComplete();
    }

    public SpawnBreakHeart(): void {
        if (!this.hasHitTargetInCurrentDrag) super.SpawnBreakHeart();
    }
}
