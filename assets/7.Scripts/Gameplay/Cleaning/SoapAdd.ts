import { _decorator, Node, ParticleSystem2D, Tween, tween, UIOpacity, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CleaningSoundMode } from './CleaningSoundMode';

const { ccclass, property } = _decorator;

class SoapTargetState {
    public hitCount = 0;
    public isActivated = false;
    public wasInsideInLastFrame = false;
    public scrubTime = 0;

    constructor(public readonly node: Node) { }
}

/**
 * Drag soap over target nodes. Each completed target is activated and plays
 * its own ParticleSystem2D (or the first ParticleSystem2D found below it).
 */
@ccclass('SoapAdd')
export class SoapAdd extends Item {
    @property({ type: Node, tooltip: 'Đầu quét xà phòng. Để trống sẽ dùng node SoapAdd.' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính quét xà phòng tại brushPoint (world units/pixels).' })
    public soapRadius = 30;

    @property({ type: [Node], tooltip: 'Các điểm target để brush quét qua và kích hoạt xà phòng.' })
    public targetNodes: Node[] = [];

    @property({ min: 1, step: 1, tooltip: 'Số lần brush đi vào target để kích hoạt particle.' })
    public hitsToActivate = 1;

    @property({ min: 0, tooltip: 'Thời gian (giây) phải chà qua lại trong bán kính của 1 target mới kích hoạt. > 0 thì dùng chế độ này thay cho hitsToActivate.' })
    public scrubTimeToActivate = 0;

    @property({ min: 0, tooltip: 'Brush phải di chuyển tối thiểu (world/frame) thì mới tính là đang chà.' })
    public scrubMinMove = 1;

    @property({ tooltip: 'Play a sound when a soap target is activated.' })
    public playCutSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Sound played when a soap target is activated.' })
    public cutFxType: FxType = FxType.Clean2;

    @property({ tooltip: 'Play a loop while dragging soap.' })
    public playDragSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Loop sound while dragging soap.' })
    public dragFxType: FxType = FxType.Clean1;

    @property({ type: Enum(CleaningSoundMode), tooltip: 'When the drag loop sound is audible.' })
    public dragSoundMode: CleaningSoundMode = CleaningSoundMode.Always;

    @property({ type: ParticleSystem2D, tooltip: 'Particle trail ở đầu SoapAdd. Tự lấy ParticleSystem2D con của Brush Point nếu để trống.' })
    public trailParticle: ParticleSystem2D | null = null;

    @property({ type: [Node], tooltip: 'Các node được bật (hiện dần) khi tất cả target đã kích hoạt (ví dụ soap_sandbox).' })
    public showOnAllDone: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node bị tắt (mờ dần) khi tất cả target đã kích hoạt (ví dụ dirty_sandbox).' })
    public hideOnAllDone: Node[] = [];

    @property({ min: 0, tooltip: 'Thời gian hiện/mờ của showOnAllDone/hideOnAllDone (giây). 0 = bật/tắt ngay.' })
    public toggleFadeDuration = 0.4;

    @property({ type: ItemCleanManager, tooltip: 'Manager điều phối lượt; chỉ hoạt động khi SoapAdd có onProcess.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi sau khi một target được kích hoạt particle.' })
    public onTargetActivated: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi tất cả target đã được kích hoạt.' })
    public onAllTargetsActivated: Ply_Event = new Ply_Event();

    private targetStates: SoapTargetState[] = [];
    private isDraggingSoap = false;
    private hasActivatedTargetInCurrentDrag = false;
    private isTrailPlaying = false;
    private isDragSoundPlaying = false;
    private brushWorldPosition = new Vec3();
    private lastBrushWorldPosition = new Vec3();
    private hasLastBrushPosition = false;
    private targetWorldPosition = new Vec3();

    private readonly boundOnDragStart = () => this.onDragStart();
    private readonly boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.trailParticle ??= this.brushPoint?.getComponentInChildren(ParticleSystem2D) ?? null;
        this.initializeTargets();
        this.stopTrailParticle();
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
        this.isDraggingSoap = false;
        this.stopDragSound();
        this.stopTrailParticle();
    }

    public initializeTargets(): void {
        this.targetStates = this.targetNodes
            .filter((node): node is Node => !!node && node.isValid)
            .map(node => new SoapTargetState(node));
    }

    /** Returns the next soap point that has not yet been activated. */
    public GetHandTutTarget(): Node | null {
        return this.targetStates.find(state => !state.isActivated && state.node.activeInHierarchy)?.node ?? null;
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem() || this.isDone) return;

        this.isDraggingSoap = true;
        this.hasLastBrushPosition = false;
        this.startDragSound();
        this.hasActivatedTargetInCurrentDrag = false;
        this.startTrailParticle();
        for (const state of this.targetStates) {
            state.wasInsideInLastFrame = false;
        }
        this.checkTargets();
    }

    public onDragEnd(): void {
        this.isDraggingSoap = false;
        this.hasLastBrushPosition = false;
        this.stopDragSound();
        this.stopTrailParticle();
        for (const state of this.targetStates) {
            state.wasInsideInLastFrame = false;
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this.isDraggingSoap) return;
        if (!this.isCurrentCleanManagerItem() || (this.itemDraggable && !this.itemDraggable.IsDragging)) {
            this.onDragEnd();
            return;
        }
        this.checkTargets(dt);
    }

    private checkTargets(dt = 0): void {
        const brush = this.brushPoint || this.node;
        brush.getWorldPosition(this.brushWorldPosition);
        const isMoving = this.hasLastBrushPosition
            && Vec3.distance(this.brushWorldPosition, this.lastBrushWorldPosition) >= this.scrubMinMove;
        this.lastBrushWorldPosition.set(this.brushWorldPosition);
        this.hasLastBrushPosition = true;
        const radiusSq = this.soapRadius * this.soapRadius;
        let isOverAnyTarget = false;

        for (const state of this.targetStates) {
            if (state.isActivated || !state.node.isValid) continue;

            state.node.getWorldPosition(this.targetWorldPosition);
            const dx = this.brushWorldPosition.x - this.targetWorldPosition.x;
            const dy = this.brushWorldPosition.y - this.targetWorldPosition.y;
            const isInside = dx * dx + dy * dy <= radiusSq;
            if (isInside) isOverAnyTarget = true;
            if (this.scrubTimeToActivate > 0) {
                // Chà lâu: cộng dồn thời gian brush di chuyển trong bán kính target.
                if (isInside && isMoving) {
                    state.scrubTime += dt;
                    this.hasActivatedTargetInCurrentDrag = true;
                    if (state.scrubTime >= this.scrubTimeToActivate) this.activateTarget(state);
                }
            } else if (isInside && !state.wasInsideInLastFrame) {
                this.hitTarget(state);
            }
            state.wasInsideInLastFrame = isInside;
        }
        this.updateDragSound(isOverAnyTarget);
    }

    private hitTarget(state: SoapTargetState): void {
        state.hitCount++;
        this.hasActivatedTargetInCurrentDrag = true;
        if (state.hitCount < Math.max(1, this.hitsToActivate)) return;
        this.activateTarget(state);
    }

    private activateTarget(state: SoapTargetState): void {
        if (state.isActivated) return;
        state.isActivated = true;
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(state.node.worldPosition);
        if (this.playCutSound) Ply_SoundManager.Ins?.PlayFx(this.cutFxType);
        state.node.active = true;
        const particle = state.node.getComponent(ParticleSystem2D) ?? state.node.getComponentInChildren(ParticleSystem2D);
        if (particle) {
            particle.node.active = true;
            particle.resetSystem();
        } else {
            console.warn(`[SoapAdd] Target "${state.node.name}" has no ParticleSystem2D.`);
        }

        this.onTargetActivated.invoke();
        if (this.targetStates.every(target => target.isActivated)) {
            this.isDone = true;
            this.toggleNodesOnAllDone();
            this.onAllTargetsActivated.invoke();
            (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
        }
    }

    private toggleNodesOnAllDone(): void {
        const duration = this.toggleFadeDuration;
        for (const node of this.showOnAllDone) {
            if (!node?.isValid) continue;
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            node.active = true;
            if (duration <= 0) {
                opacity.opacity = 255;
                continue;
            }
            opacity.opacity = 0;
            tween(opacity).to(duration, { opacity: 255 }, { easing: 'sineOut' }).start();
        }

        for (const node of this.hideOnAllDone) {
            if (!node?.isValid) continue;
            if (duration <= 0) {
                node.active = false;
                continue;
            }
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            tween(opacity)
                .to(duration, { opacity: 0 }, { easing: 'sineIn' })
                .call(() => {
                    node.active = false;
                    opacity.opacity = 255;
                })
                .start();
        }
    }

    private startDragSound(isOverTarget = false): void {
        if (!this.playDragSound || (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget)
            || this.isDragSoundPlaying || !Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.dragFxType);
        this.isDragSoundPlaying = true;
    }

    private updateDragSound(isOverTarget: boolean): void {
        if (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget) {
            this.stopDragSound();
            return;
        }
        this.startDragSound(isOverTarget);
    }

    private stopDragSound(): void {
        if (!this.isDragSoundPlaying) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.dragFxType);
        this.isDragSoundPlaying = false;
    }

    private startTrailParticle(): void {
        if (!this.trailParticle) return;

        this.trailParticle.node.active = true;
        this.trailParticle.enabled = true;
        this.trailParticle.duration = -1;
        this.trailParticle.autoRemoveOnFinish = false;
        if (this.isTrailPlaying) return;

        this.trailParticle.resetSystem();
        this.isTrailPlaying = true;
    }

    private stopTrailParticle(): void {
        if (!this.trailParticle) return;
        this.trailParticle.stopSystem();
        this.isTrailPlaying = false;
    }

    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /** Không hiện BreakHeart khi lượt kéo vừa rồi đã soap trúng ít nhất một target. */
    public OnDragFailReturnComplete(): void {
        if (!this.hasActivatedTargetInCurrentDrag) {
            super.OnDragFailReturnComplete();
        }
    }

    public SpawnBreakHeart(): void {
        if (!this.hasActivatedTargetInCurrentDrag) {
            super.SpawnBreakHeart();
        }
    }
}
